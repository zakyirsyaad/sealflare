import type { Db } from '@sealflare/internal/db'
import { CHALLENGE_OUTCOMES, nameOf } from '../enums'
import type { TimedCourtEvent } from '../decodeCourt'
import { labelOfTarget, missingRow, requireChallenge, requireTarget } from './rows'

/**
 * Writes one Court event into the database.
 *
 * The event is applied inside the same transaction as the raw log and the cursor, so a failure
 * anywhere leaves the database exactly as it was.
 */

/** The time of a block, as the contract counts it: seconds since the epoch. */
function at(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString()
}

export async function applyCourtEvent(tx: Db, event: TimedCourtEvent): Promise<void> {
  switch (event.name) {
    case 'ChallengeOpened':
      return applyChallengeOpened(tx, event)
    case 'CounterEvidenceSubmitted':
      return applyCounterEvidence(tx, event)
    case 'VoteCommitted':
      return applyVoteCommitted(tx, event)
    case 'VoteRevealed':
      return applyVoteRevealed(tx, event)
    case 'ChallengeResolved':
      return applyChallengeResolved(tx, event)
    case 'ChallengeExpired':
      return applyChallengeExpired(tx, event)
  }
}

/**
 * A new dispute.
 *
 * The label of the challenge is the label of its target, because the contract does not carry one
 * and the read model asks for a name on every row. The phase of the row is the phase the
 * challenge was opened in; the answer carries the phase the challenge is in right now, which
 * only the clock and the windows of the challenge know.
 */
async function applyChallengeOpened(tx: Db, event: TimedCourtEvent & { name: 'ChallengeOpened' }): Promise<void> {
  await requireTarget(tx, event.args.targetId, 'Court')
  const label = await labelOfTarget(tx, event.args.targetId)
  await tx.query(
    `INSERT INTO challenges (id, target_id, label, challenger, phase, outcome, flags, short_proof,
       evidence_uri, commits, reveals, commit_ends_at, reveal_ends_at, created_at_block, created_at)
     VALUES ($1, $2, $3, $4, 'COMMIT', 'PENDING', $5, $6, $7, 0, 0, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.args.id.toString(),
      event.args.targetId,
      label,
      event.args.challenger.toLowerCase(),
      event.args.flags,
      event.args.shortProof,
      event.args.evidenceURI,
      at(event.args.commitEndsAt),
      at(event.args.revealEndsAt),
      event.blockNumber.toString(),
      event.at.toISOString(),
    ],
  )
}

/**
 * The reply of the publisher.
 *
 * Only the verified publisher of the target may answer, so the address of the reply is the
 * publisher of record as well.
 */
async function applyCounterEvidence(
  tx: Db,
  event: TimedCourtEvent & { name: 'CounterEvidenceSubmitted' },
): Promise<void> {
  await requireChallenge(tx, event.args.id, 'Court')
  await tx.query('UPDATE challenges SET counter_evidence_uri = $2, publisher = $3 WHERE id = $1', [
    event.args.id.toString(),
    event.args.uri,
    event.args.publisher.toLowerCase(),
  ])
}

/**
 * A juror joins the jury.
 *
 * The direction of the vote is not part of the event and the commit hash is not either, so
 * nothing about the vote is stored here but the weight, which the contract freezes at this
 * moment. The direction stays empty until the juror reveals it.
 */
async function applyVoteCommitted(tx: Db, event: TimedCourtEvent & { name: 'VoteCommitted' }): Promise<void> {
  await requireChallenge(tx, event.args.id, 'Court')
  const rows = await tx.query<{ inserted: boolean }>(
    `INSERT INTO jurors (challenge_id, address, weight, revealed, uphold, at)
     VALUES ($1, $2, $3, false, NULL, $4)
     ON CONFLICT (challenge_id, address) DO NOTHING
     RETURNING true AS inserted`,
    [event.args.id.toString(), event.args.juror.toLowerCase(), event.args.weight, event.at.toISOString()],
  )
  // The counter only moves when a juror is new, so a range that is read twice counts no juror twice.
  if (rows.length > 0) {
    await tx.query('UPDATE challenges SET commits = commits + 1 WHERE id = $1', [event.args.id.toString()])
  }
}

/** A juror reveals the direction of its vote. */
async function applyVoteRevealed(tx: Db, event: TimedCourtEvent & { name: 'VoteRevealed' }): Promise<void> {
  await requireChallenge(tx, event.args.id, 'Court')
  const updated = await tx.query<{ address: string }>(
    `UPDATE jurors SET revealed = true, uphold = $3
     WHERE challenge_id = $1 AND address = $2
     RETURNING address`,
    [event.args.id.toString(), event.args.juror.toLowerCase(), event.args.uphold],
  )
  if (updated.length === 0) {
    throw missingRow('juror', `${event.args.juror.toLowerCase()} of challenge ${event.args.id}`, 'Court')
  }
  await tx.query(
    `UPDATE challenges SET
       reveals = reveals + 1,
       uphold_weight = uphold_weight + $2,
       reject_weight = reject_weight + $3
     WHERE id = $1`,
    [
      event.args.id.toString(),
      event.args.uphold ? event.args.weight : 0,
      event.args.uphold ? 0 : event.args.weight,
    ],
  )
}

/** The verdict. The challenge is closed from here on. */
async function applyChallengeResolved(tx: Db, event: TimedCourtEvent & { name: 'ChallengeResolved' }): Promise<void> {
  const outcome = nameOf(CHALLENGE_OUTCOMES, event.args.outcome)
  if (!outcome) throw new Error(`The Court resolved a challenge with an unknown outcome ${event.args.outcome}`)
  await requireChallenge(tx, event.args.id, 'Court')
  await tx.query(
    `UPDATE challenges SET outcome = $2, phase = 'CLOSED', uphold_weight = $3, reject_weight = $4
     WHERE id = $1`,
    [event.args.id.toString(), outcome, event.args.upholdWeight, event.args.rejectWeight],
  )
}

/** The dispute ran out of time before the jury could decide. */
async function applyChallengeExpired(tx: Db, event: TimedCourtEvent & { name: 'ChallengeExpired' }): Promise<void> {
  await requireChallenge(tx, event.args.id, 'Court')
  await tx.query(
    `UPDATE challenges SET outcome = 'EXPIRED', phase = 'CLOSED', reveals = $2 WHERE id = $1`,
    [event.args.id.toString(), event.args.reveals],
  )
}
