import type { Address, Hex } from 'viem'
import { weightOf } from '@sealflare/shared/rules'
import type { Db } from '@sealflare/internal/db'
import type { TimedEvent } from '../decode'
import { CHALLENGE_OUTCOMES, PUBLISHER_ROLES, SCORE_REASONS, TARGET_TYPE_NAMES, VERDICT_NAMES, nameOf } from '../enums'
import { missingRow, requireGuardian, requireTarget } from './rows'
import { fillBountySlot } from './vault'

/** The address the contract stores as a bytes32. */
function addressOf(target: Hex): Address {
  return `0x${target.slice(-40)}`.toLowerCase() as Address
}

const lower = (address: Address): string => address.toLowerCase()

/**
 * Writes one Core event into the database.
 *
 * The event is applied inside the same transaction as the raw log and the cursor, so a failure
 * anywhere leaves the database exactly as it was.
 */
export async function applyCoreEvent(tx: Db, event: TimedEvent): Promise<void> {
  switch (event.name) {
    case 'TargetCreated':
      return applyTargetCreated(tx, event)
    case 'GuardianCreated':
      return applyGuardianCreated(tx, event)
    case 'Attested':
      return applyAttested(tx, event)
    case 'PublisherBound':
      return applyPublisherBound(tx, event)
    case 'DelegatecallFlagged':
      return applyDelegatecallFlagged(tx, event)
    case 'AttestationSettled':
      return applyAttestationSettled(tx, event)
    case 'ScoreChanged':
      return applyScoreChanged(tx, event)
    case 'DisputeMarked':
      return applyDisputeMarked(tx, event)
    case 'VerdictApplied':
      return applyVerdictApplied(tx, event)
    case 'ModulesSet':
      // The module status is read from the contract, not from the indexer, so this event only
      // lives in the raw log.
      return
  }
}

async function applyTargetCreated(tx: Db, event: TimedEvent & { name: 'TargetCreated' }): Promise<void> {
  const targetType = nameOf(TARGET_TYPE_NAMES, event.args.targetType)
  if (!targetType) throw new Error(`The Core contract created a target of unknown type ${event.args.targetType}`)
  const isContract = targetType === 'SMART_CONTRACT'
  const address = isContract ? addressOf(event.args.target) : null
  await tx.query(
    `INSERT INTO targets (target_id, target_type, label, src, codehash, bundle_hash, created_at_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (target_id) DO NOTHING`,
    [
      event.args.targetId,
      targetType,
      address ?? event.args.target,
      address,
      isContract ? event.args.pinnedCodehash : null,
      isContract ? null : event.args.target,
      event.blockNumber.toString(),
    ],
  )
}

async function applyGuardianCreated(tx: Db, event: TimedEvent & { name: 'GuardianCreated' }): Promise<void> {
  await tx.query(
    `INSERT INTO guardians (address, score, weight, attestations, created_at_block)
     VALUES ($1, 0, 0, 0, $2)
     ON CONFLICT (address) DO NOTHING`,
    [lower(event.args.guardian), event.args.createdAtBlock.toString()],
  )
}

async function applyAttested(tx: Db, event: TimedEvent & { name: 'Attested' }): Promise<void> {
  const verdict = nameOf(VERDICT_NAMES, event.args.verdict)
  if (!verdict) throw new Error(`The Core contract recorded a vote with an unknown verdict ${event.args.verdict}`)
  await requireTarget(tx, event.args.targetId, 'Core')
  await requireGuardian(tx, event.args.guardian, 'Core')
  const duringDispute = await isUnderDispute(tx, event.args.targetId)
  await tx.query(
    `INSERT INTO attestations (tx_hash, log_index, target_id, guardian, verdict, flags, weight,
       attestation_index, safe_ordinal, short_proof, evidence_uri, cast_during_dispute, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      event.txHash,
      event.logIndex,
      event.args.targetId,
      lower(event.args.guardian),
      verdict,
      event.args.flags,
      event.args.weight,
      event.args.index,
      event.args.safeOrdinal,
      event.args.shortProof,
      event.args.evidenceURI,
      duringDispute,
      event.at.toISOString(),
    ],
  )
  // The contract counts the vote on the Guardian too, so the Guardians list and profile can show it.
  await tx.query('UPDATE guardians SET attestations = attestations + 1 WHERE address = $1', [
    lower(event.args.guardian),
  ])
  await tx.query(
    `UPDATE targets SET
       safe_count = safe_count + $2,
       caution_count = caution_count + $3,
       danger_count = danger_count + $4,
       active_flags = active_flags | $5,
       last_vote_at = $6
     WHERE target_id = $1`,
    [
      event.args.targetId,
      verdict === 'SAFE' ? 1 : 0,
      verdict === 'CAUTION' ? 1 : 0,
      verdict === 'DANGER' ? 1 : 0,
      event.args.flags,
      event.at.toISOString(),
    ],
  )
  // A vote may fill a slot of a bounty of its target, when the bounty was made before the vote.
  await fillBountySlot(tx, {
    targetId: event.args.targetId,
    attestationIndex: event.args.index,
    guardian: event.args.guardian,
    verdict,
    at: event.at,
  })
}

/** A vote that happened while a challenge was open was cast during a dispute. */
async function isUnderDispute(tx: Db, targetId: Hex): Promise<boolean> {
  const rows = await tx.query<{ disputed: boolean }>(
    'SELECT (active_challenge_id IS NOT NULL) AS disputed FROM targets WHERE target_id = $1',
    [targetId],
  )
  return rows[0]?.disputed ?? false
}

/**
 * Stops the indexer when the row an event names is not in the database.
 *
 * The indexer reads from `START_BLOCK` onwards, so a start block that is too late leaves out the
 * rows of the earlier events. The event then names a target or a guardian the database has never
 * heard of, and the write would quietly change nothing. That would leave a target looking
 * unflagged and unconfirmed, so the indexer stops here and says what to fix.
 */
async function requireAttestation(tx: Db, targetId: Hex, index: number): Promise<void> {
  const rows = await tx.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM attestations WHERE target_id = $1 AND attestation_index = $2) AS found',
    [targetId, index],
  )
  if (!rows[0]?.found) throw missingRow('attestation', `${targetId} index ${index}`, 'Core')
}

async function applyPublisherBound(tx: Db, event: TimedEvent & { name: 'PublisherBound' }): Promise<void> {
  const role = nameOf(PUBLISHER_ROLES, event.args.role)
  if (!role) throw new Error(`The Core contract bound a publisher with an unknown role ${event.args.role}`)
  await requireTarget(tx, event.args.targetId, 'Core')
  await tx.query('UPDATE targets SET publisher = $2, publisher_role = $3 WHERE target_id = $1', [
    event.args.targetId,
    lower(event.args.publisher),
    role,
  ])
}

async function applyDelegatecallFlagged(
  tx: Db,
  event: TimedEvent & { name: 'DelegatecallFlagged' },
): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Core')
  await tx.query('UPDATE targets SET has_delegatecall = true WHERE target_id = $1', [event.args.targetId])
}

async function applyAttestationSettled(
  tx: Db,
  event: TimedEvent & { name: 'AttestationSettled' },
): Promise<void> {
  await requireAttestation(tx, event.args.targetId, event.args.index)
  await tx.query(
    'UPDATE attestations SET settled = true, settled_xp = $3 WHERE target_id = $1 AND attestation_index = $2',
    [event.args.targetId, event.args.index, event.args.delta],
  )
}

async function applyScoreChanged(tx: Db, event: TimedEvent & { name: 'ScoreChanged' }): Promise<void> {
  const reason = nameOf(SCORE_REASONS, event.args.reason) ?? String(event.args.reason)
  await requireGuardian(tx, event.args.guardian, 'Core')
  await tx.query(
    `INSERT INTO score_changes (guardian, tx_hash, log_index, delta, reason, at, target_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (guardian, tx_hash, log_index) DO NOTHING`,
    [
      lower(event.args.guardian),
      event.txHash,
      event.logIndex,
      event.args.delta,
      reason,
      event.at.toISOString(),
      event.args.targetId,
    ],
  )
  await tx.query('UPDATE guardians SET score = $2, weight = $3 WHERE address = $1', [
    lower(event.args.guardian),
    event.args.newScore,
    weightOf(event.args.newScore),
  ])
  // A penalty for a SAFE vote on a target that was confirmed dangerous is charged once. The
  // guardian does not owe it any more once the contract has charged it.
  if (reason === 'SAFE_ON_DANGER') {
    await tx.query(
      'UPDATE guardians SET pending_penalties = GREATEST(pending_penalties - 1, 0) WHERE address = $1',
      [lower(event.args.guardian)],
    )
  }
}

async function applyDisputeMarked(tx: Db, event: TimedEvent & { name: 'DisputeMarked' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Core')
  await tx.query('UPDATE targets SET active_challenge_id = $2 WHERE target_id = $1', [
    event.args.targetId,
    event.args.challengeId.toString(),
  ])
}

async function applyVerdictApplied(tx: Db, event: TimedEvent & { name: 'VerdictApplied' }): Promise<void> {
  const outcome = nameOf(CHALLENGE_OUTCOMES, event.args.outcome)
  if (!outcome) throw new Error(`The Core contract applied a verdict with an unknown outcome ${event.args.outcome}`)
  await requireTarget(tx, event.args.targetId, 'Core')
  const before = await tx.query<{ confirmed_danger: boolean }>(
    'SELECT confirmed_danger FROM targets WHERE target_id = $1',
    [event.args.targetId],
  )
  // The contract adds the verdict's flags only to the verdict that confirms the danger for the
  // first time, so the flags of a later verdict are left out.
  await tx.query(
    `UPDATE targets SET
       active_challenge_id = NULL,
       confirmed_danger = CASE WHEN $2 = 'UPHELD' THEN true ELSE confirmed_danger END,
       active_flags = CASE WHEN $2 = 'UPHELD' AND NOT confirmed_danger THEN active_flags | $3 ELSE active_flags END
     WHERE target_id = $1`,
    [event.args.targetId, outcome, event.args.flags],
  )
  // A SAFE vote on a target that is confirmed dangerous owes a penalty that the contract has
  // not charged yet. Only the verdict that confirms the danger counts, because a later verdict
  // confirms nothing new.
  if (outcome === 'UPHELD' && !before[0]?.confirmed_danger) {
    await addPendingPenalties(tx, event.args.targetId)
  }
}

/**
 * The penalties the guardians of a target owe.
 *
 * Every SAFE vote on the target is a penalty the contract has not charged yet, and the counter
 * of the guardian moves with it.
 */
async function addPendingPenalties(tx: Db, targetId: Hex): Promise<void> {
  await tx.query(
    `UPDATE guardians SET pending_penalties = pending_penalties + 1
     WHERE address IN (SELECT guardian FROM attestations WHERE target_id = $1 AND verdict = 'SAFE')`,
    [targetId],
  )
}
