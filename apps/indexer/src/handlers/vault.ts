import type { Address, Hex } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'
import type { Db } from '@sealflare/internal/db'
import type { TimedVaultEvent } from '../decodeVault'
import { labelOfKnownTarget, requireBounty, requireChallenge, requireTarget } from './rows'

/**
 * Writes one Vault event into the database.
 *
 * The event is applied inside the same transaction as the raw log and the cursor, so a failure
 * anywhere leaves the database exactly as it was.
 */

/** The window a slot of a bounty can be filled in, in seconds. */
const BOUNTY_WINDOW = BigInt(CONSTANTS.BOUNTY_TIMEOUT)
/** The time a bounty waits after its last slot filled, in seconds. */
const SETTLE_DELAY = BigInt(CONSTANTS.SETTLE_DELAY)

export async function applyVaultEvent(tx: Db, event: TimedVaultEvent): Promise<void> {
  switch (event.name) {
    case 'BondDeposited':
      return applyBondDeposited(tx, event)
    case 'BondWithdrawalRequested':
      return applyBondWithdrawalRequested(tx, event)
    case 'BondWithdrawn':
      return applyBondWithdrawn(tx, event)
    case 'BondLocked':
      return applyBondLocked(tx, event)
    case 'BondSettled':
      return applyBondSettled(tx, event)
    case 'StakeDeposited':
      return applyStakeDeposited(tx, event)
    case 'Distributed':
      return applyDistributed(tx, event)
    case 'BountyCreated':
      return applyBountyCreated(tx, event)
    case 'BountySettled':
      return applyBountySettled(tx, event)
    case 'BalanceCredited':
      return applyBalanceCredited(tx, event)
    case 'Withdrawn':
      return applyWithdrawn(tx, event)
  }
}

/**
 * The bond a target shows is the bond of its publisher of record.
 *
 * The rule is the one of `Vault.activeBond`: only the publisher's own bond counts, and it stops
 * counting the moment a withdrawal is asked for, although it stays slashable until it is
 * finalized. The `bonds` table keeps the bond itself; the target keeps what counts. The Core event
 * that binds a new publisher refreshes it too, because the bond that counts follows the publisher.
 */
export async function refreshTargetBond(tx: Db, targetId: Hex): Promise<void> {
  await tx.query(
    `UPDATE targets SET bond = COALESCE(
       (SELECT CASE WHEN b.withdrawable_at IS NULL THEN b.amount ELSE 0 END
          FROM bonds b
         WHERE b.target_id = targets.target_id AND b.depositor = targets.publisher),
       0)
     WHERE target_id = $1`,
    [targetId],
  )
}

/**
 * A warranty bond grows.
 *
 * A deposit cancels a withdrawal that was asked for before, because the contract zeroes the
 * moment the withdrawal becomes available.
 */
async function applyBondDeposited(tx: Db, event: TimedVaultEvent & { name: 'BondDeposited' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Vault')
  await tx.query(
    `INSERT INTO bonds (target_id, depositor, amount, requested_at, withdrawable_at, finalized_at, locked, created_at)
     VALUES ($1, $2, $3, NULL, NULL, NULL, false, $4)
     ON CONFLICT (target_id, depositor) DO UPDATE SET
       amount = EXCLUDED.amount,
       requested_at = NULL,
       withdrawable_at = NULL,
       finalized_at = NULL`,
    [event.args.targetId, event.args.depositor.toLowerCase(), event.args.total.toString(), event.at.toISOString()],
  )
  await refreshTargetBond(tx, event.args.targetId)
}

/**
 * The publisher asks for its bond back. It stays slashable until it is finalized.
 *
 * A bond row is written by the deposit alone, so an event for a bond the database does not have
 * changes nothing. That is what the local stub does: it reports the life of a bond that was
 * never deposited. The target of the bond is required all the same, because a target that the
 * database does not have means that the indexer started too late.
 */
async function applyBondWithdrawalRequested(
  tx: Db,
  event: TimedVaultEvent & { name: 'BondWithdrawalRequested' },
): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Vault')
  await tx.query(
    `UPDATE bonds SET requested_at = $3, withdrawable_at = $4
     WHERE target_id = $1 AND depositor = $2`,
    [
      event.args.targetId,
      event.args.depositor.toLowerCase(),
      event.at.toISOString(),
      new Date(Number(event.args.availableAt) * 1000).toISOString(),
    ],
  )
  await refreshTargetBond(tx, event.args.targetId)
}

/** The bond left the Vault. The amount is credited to the balance of its owner. */
async function applyBondWithdrawn(tx: Db, event: TimedVaultEvent & { name: 'BondWithdrawn' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Vault')
  await tx.query(
    `UPDATE bonds SET amount = 0, withdrawable_at = NULL, finalized_at = $3
     WHERE target_id = $1 AND depositor = $2`,
    [event.args.targetId, event.args.depositor.toLowerCase(), event.at.toISOString()],
  )
  await refreshTargetBond(tx, event.args.targetId)
}

/** The bond of the publisher of record is locked for the duration of a dispute. */
async function applyBondLocked(tx: Db, event: TimedVaultEvent & { name: 'BondLocked' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Vault')
  await tx.query(
    `UPDATE bonds SET locked = true, locked_by_challenge_id = $3
     WHERE target_id = $1 AND depositor = $2`,
    [event.args.targetId, event.args.depositor.toLowerCase(), event.args.challengeId.toString()],
  )
}

/**
 * The dispute is over: part of the bond was slashed into the escrow and the rest stays a bond.
 */
async function applyBondSettled(tx: Db, event: TimedVaultEvent & { name: 'BondSettled' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Vault')
  await tx.query(
    `UPDATE bonds SET amount = $3, locked = false, locked_by_challenge_id = NULL
     WHERE target_id = $1 AND depositor = $2`,
    [event.args.targetId, event.args.depositor.toLowerCase(), event.args.released.toString()],
  )
  await refreshTargetBond(tx, event.args.targetId)
  // The slashed part of the bond is paid out with the escrow of the challenge.
  await addToEscrow(tx, event, event.args.challengeId, event.args.slashed)
}

/**
 * A stake joined the escrow of a challenge.
 *
 * The stake is paid in the same transaction as the event that names its challenge. The real Court
 * emits that event first (`openChallenge` emits `ChallengeOpened` and `commitVote` emits
 * `VoteCommitted` before either calls `depositStake`), but `CourtStub`, which the local chain and
 * these tests run against, calls `depositStake` first. So the row of the dispute may not be there
 * yet, and the stake is written without requiring it. Requiring it, so that a late `START_BLOCK`
 * is caught here too, needs the stub to emit first, which is a change in `contracts/` for the
 * founder.
 */
async function applyStakeDeposited(tx: Db, event: TimedVaultEvent & { name: 'StakeDeposited' }): Promise<void> {
  await addToEscrow(tx, event, event.args.challengeId, event.args.amount)
}

/**
 * The escrow of a challenge paid a recipient.
 *
 * The rows of a payout belong to the challenge of the event alone, so a challenge never shows
 * the money of another one.
 */
async function applyDistributed(tx: Db, event: TimedVaultEvent & { name: 'Distributed' }): Promise<void> {
  await requireChallenge(tx, event.args.challengeId, 'Vault')
  await tx.query(
    `INSERT INTO payouts (challenge_id, tx_hash, log_index, recipient, amount, at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      event.args.challengeId.toString(),
      event.txHash,
      event.logIndex,
      event.args.recipient.toLowerCase(),
      event.args.amount.toString(),
      event.at.toISOString(),
    ],
  )
  await addToEscrow(tx, event, event.args.challengeId, -event.args.amount)
}

/** A bounty was created. Its slots fill from the attestations that come after it. */
async function applyBountyCreated(tx: Db, event: TimedVaultEvent & { name: 'BountyCreated' }): Promise<void> {
  // The target may not exist yet: `createBounty` reads a target Core has not recorded as one with
  // no attestations, so asking for the first ones on a new contract is normal. The label follows
  // when `TargetCreated` arrives, and a missing row here must never stop the indexer.
  const label = await labelOfKnownTarget(tx, event.args.targetId)
  const createdAt = event.at.toISOString()
  await tx.query(
    `INSERT INTO bounties (id, target_id, label, requester, slots, amount, created_at, settleable_at, settled, start_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.args.id.toString(),
      event.args.targetId,
      label,
      event.args.requester.toLowerCase(),
      event.args.slots,
      event.args.amount.toString(),
      createdAt,
      new Date(event.at.getTime() + Number(BOUNTY_WINDOW) * 1000).toISOString(),
      event.args.startIndex,
    ],
  )
}

/** The bounty was paid out. */
async function applyBountySettled(tx: Db, event: TimedVaultEvent & { name: 'BountySettled' }): Promise<void> {
  await requireBounty(tx, event.args.id, 'Vault')
  await tx.query('UPDATE bounties SET settled = true WHERE id = $1', [event.args.id.toString()])
}

/** Something was added to the balance of an account. */
async function applyBalanceCredited(tx: Db, event: TimedVaultEvent & { name: 'BalanceCredited' }): Promise<void> {
  await addToBalance(tx, event, 'CREDIT', event.args.amount)
}

/** An account took its balance out of the Vault. */
async function applyWithdrawn(tx: Db, event: TimedVaultEvent & { name: 'Withdrawn' }): Promise<void> {
  await addToBalance(tx, event, 'WITHDRAW', event.args.amount)
}

/**
 * One row of the balance ledger.
 *
 * A balance is the sum of the credits minus the sum of the withdrawals, so the ledger is kept
 * row by row and never overwritten.
 */
async function addToBalance(
  tx: Db,
  event: TimedVaultEvent & { args: { account: Address; amount: bigint } },
  kind: 'CREDIT' | 'WITHDRAW',
  amount: bigint,
): Promise<void> {
  await tx.query(
    `INSERT INTO balances (address, tx_hash, log_index, kind, amount, at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (address, tx_hash, log_index) DO NOTHING`,
    [event.args.account.toLowerCase(), event.txHash, event.logIndex, kind, amount.toString(), event.at.toISOString()],
  )
}

/** What the escrow of a challenge holds. */
async function addToEscrow(
  tx: Db,
  event: TimedVaultEvent,
  challengeId: bigint,
  amount: bigint,
): Promise<void> {
  await tx.query(
    `INSERT INTO escrow_movements (challenge_id, tx_hash, log_index, delta, at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [challengeId.toString(), event.txHash, event.logIndex, amount.toString(), event.at.toISOString()],
  )
}

/**
 * One slot of a bounty fills with an attestation.
 *
 * The slots of a bounty fill from the attestations of its target that come after the bounty was
 * created. The attestation of the requester never fills a slot, the scan stops at the number of
 * slots and it stops for good at the end of the seven day window.
 */
export async function fillBountySlot(
  tx: Db,
  slot: { targetId: Hex; attestationIndex: number; guardian: Address; verdict: string; at: Date },
): Promise<void> {
  const guardian = slot.guardian.toLowerCase()
  const bounties = await tx.query<{ id: string; requester: string; slots: number }>(
    `SELECT id, requester, slots FROM bounties
     WHERE target_id = $1 AND settled = false AND start_index <= $2
       AND $3::timestamptz < created_at + ($4::bigint * interval '1 second')
     ORDER BY id ASC`,
    [slot.targetId, slot.attestationIndex, slot.at.toISOString(), BOUNTY_WINDOW.toString()],
  )
  for (const bounty of bounties) {
    // The requester never fills a slot of its own bounty, and the scan goes on.
    if (bounty.requester === guardian) continue
    const filled = await tx.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM bounty_fillers WHERE bounty_id = $1',
      [bounty.id],
    )
    if ((filled[0]?.count ?? 0) >= bounty.slots) continue
    await tx.query(
      `INSERT INTO bounty_fillers (bounty_id, guardian, verdict, at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (bounty_id, guardian) DO NOTHING`,
      [bounty.id, guardian, slot.verdict, slot.at.toISOString()],
    )
    await updateSettleableAt(tx, bounty.id, slot.at)
  }
}

/**
 * When a bounty can be settled.
 *
 * A bounty whose slots are full waits 48 hours after its last slot filled, and a bounty that
 * never fills waits the seven days of its window. Whichever comes first is the moment the
 * bounty can be settled.
 */
async function updateSettleableAt(tx: Db, bountyId: string, filledAt: Date): Promise<void> {
  await tx.query(
    `UPDATE bounties SET settleable_at = LEAST(created_at + ($2::bigint * interval '1 second'), $3::timestamptz + ($4::bigint * interval '1 second'))
     WHERE id = $1 AND (SELECT count(*) FROM bounty_fillers WHERE bounty_id = $1) = slots`,
    [bountyId, BOUNTY_WINDOW.toString(), filledAt.toISOString(), SETTLE_DELAY.toString()],
  )
}
