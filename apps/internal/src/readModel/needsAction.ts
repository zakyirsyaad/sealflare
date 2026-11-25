import { CONSTANTS } from '@sealflare/shared/rules'
import { Bytes32Schema, type NeedsAction } from '@sealflare/shared/schemas'
import type { Db } from '../db'

/**
 * What an account still has to do, and when it is due.
 *
 * The moment is passed in, so the answer is the same for the same moment and a test can say
 * when a deadline has passed. The system clock is never read inside this module.
 *
 * The six kinds come from the My activity screen: a vote to reveal, a reply to write, a dispute
 * to close, XP to claim, a bond to finalize and a bounty to settle.
 */

/** The kinds of action, in the order the screen shows them when two are due at the same time. */
const KIND_ORDER: NeedsAction['kind'][] = [
  'REVEAL_DUE',
  'REPLY_DUE',
  'CAN_CLOSE',
  'XP_CLAIMABLE',
  'BOND_READY',
  'BOUNTY_SETTLEABLE',
]

/** How long a safe vote waits before it can be settled, in seconds. */
const SETTLE_DELAY = BigInt(CONSTANTS.SETTLE_DELAY)

/**
 * The actions of one account, the ones that are due first at the top.
 *
 * Every kind is read from the indexed rows, so an action never says something the chain has not
 * said yet.
 */
export async function needsActionFor(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const lower = address.toLowerCase()
  const actions = [
    ...(await revealDue(sql, lower, now)),
    ...(await replyDue(sql, lower, now)),
    ...(await canClose(sql, lower, now)),
    ...(await xpClaimable(sql, lower, now)),
    ...(await bondReady(sql, lower, now)),
    ...(await bountySettleable(sql, lower, now)),
  ]
  return sortByDueTime(actions)
}

/**
 * A vote that was committed but not revealed, while the reveal window is still open.
 *
 * The direction of the vote is not read here: the action only says that a vote is waiting.
 */
async function revealDue(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ challenge_id: string; target_id: string; reveal_ends_at: Date | string }>(
    `SELECT j.challenge_id, c.target_id, c.reveal_ends_at
     FROM jurors j JOIN challenges c ON c.id = j.challenge_id
     WHERE j.address = $1 AND j.revealed = false AND c.outcome = 'PENDING'
       AND c.commit_ends_at <= $2 AND c.reveal_ends_at > $2`,
    [address, now.toISOString()],
  )
  return rows.map((row) => ({
    kind: 'REVEAL_DUE',
    targetId: Bytes32Schema.parse(row.target_id),
    challengeId: row.challenge_id,
    dueAt: isoDate(row.reveal_ends_at),
    detail: 'Your vote in this challenge has to be revealed before the reveal window closes.',
  }))
}

/**
 * A reply the publisher of a target still owes, while jurors can still commit.
 *
 * Only the verified publisher may answer, and a reply that was already given is not asked for
 * again.
 */
async function replyDue(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ id: string; target_id: string; commit_ends_at: Date | string }>(
    `SELECT c.id, c.target_id, c.commit_ends_at
     FROM challenges c JOIN targets t ON t.target_id = c.target_id
     WHERE t.publisher = $1 AND t.publisher_role = 'VERIFIED_PUBLISHER'
       AND c.outcome = 'PENDING' AND c.commit_ends_at > $2
       AND (c.counter_evidence_uri IS NULL OR c.counter_evidence_uri = '')`,
    [address, now.toISOString()],
  )
  return rows.map((row) => ({
    kind: 'REPLY_DUE',
    targetId: Bytes32Schema.parse(row.target_id),
    challengeId: row.id,
    dueAt: isoDate(row.commit_ends_at),
    detail: 'The publisher of this target may still answer this challenge.',
  }))
}

/**
 * A dispute that can be closed, because the reveal window is over and enough jurors revealed.
 *
 * The dispute is closable by anyone, but the action is only shown to the challenger and to the
 * jurors of that dispute, because they are the ones who wait for it.
 */
async function canClose(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ id: string; target_id: string; reveal_ends_at: Date | string }>(
    `SELECT c.id, c.target_id, c.reveal_ends_at
     FROM challenges c
     WHERE c.outcome = 'PENDING' AND c.reveal_ends_at <= $2 AND c.reveals >= $3
       AND (c.challenger = $1 OR EXISTS (
         SELECT 1 FROM jurors j WHERE j.challenge_id = c.id AND j.address = $1))`,
    [address, now.toISOString(), CONSTANTS.MIN_REVEALS],
  )
  return rows.map((row) => ({
    kind: 'CAN_CLOSE',
    targetId: Bytes32Schema.parse(row.target_id),
    challengeId: row.id,
    dueAt: isoDate(row.reveal_ends_at),
    detail: 'The reveal window of this challenge is over, so it can be closed.',
  }))
}

/**
 * A safe vote that has waited out its 48 hours and can be settled.
 *
 * A vote on a target that is confirmed dangerous, or on a target with an open dispute, cannot be
 * settled, so it is not offered here.
 */
async function xpClaimable(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ target_id: string; at: Date | string }>(
    `SELECT a.target_id, a.at
     FROM attestations a JOIN targets t ON t.target_id = a.target_id
     WHERE a.guardian = $1 AND a.verdict = 'SAFE' AND a.settled = false
       AND t.confirmed_danger = false AND t.active_challenge_id IS NULL
       AND a.at + ($2::bigint * interval '1 second') <= $3`,
    [address, SETTLE_DELAY.toString(), now.toISOString()],
  )
  return rows.map((row) => ({
    kind: 'XP_CLAIMABLE',
    targetId: Bytes32Schema.parse(row.target_id),
    dueAt: isoDate(addSeconds(row.at, SETTLE_DELAY)),
    detail: 'This safe vote has waited out its 48 hours, so its XP can be settled.',
  }))
}

/**
 * A bond whose withdrawal may be finalized.
 *
 * The bond stays slashable until it is finalized, so the action waits for the whole unbonding
 * window of seven days.
 */
async function bondReady(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ target_id: string; withdrawable_at: Date | string }>(
    `SELECT target_id, withdrawable_at FROM bonds
     WHERE depositor = $1 AND requested_at IS NOT NULL AND withdrawable_at IS NOT NULL
       AND finalized_at IS NULL AND withdrawable_at <= $2`,
    [address, now.toISOString()],
  )
  return rows.map((row) => ({
    kind: 'BOND_READY',
    targetId: Bytes32Schema.parse(row.target_id),
    dueAt: isoDate(row.withdrawable_at),
    detail: 'The unbonding window of this bond is over, so its withdrawal can be finalized.',
  }))
}

/**
 * A bounty of the account that can be settled.
 *
 * A bounty waits 48 hours after its last slot filled, or seven days after it was made when its
 * slots never filled. The indexer stores the moment the bounty became settleable.
 */
async function bountySettleable(sql: Db, address: string, now: Date): Promise<NeedsAction[]> {
  const rows = await sql.query<{ id: string; target_id: string; settleable_at: Date | string }>(
    `SELECT id, target_id, settleable_at FROM bounties
     WHERE requester = $1 AND settled = false AND settleable_at IS NOT NULL
       AND settleable_at <= $2`,
    [address, now.toISOString()],
  )
  return rows.map((row) => ({
    kind: 'BOUNTY_SETTLEABLE',
    targetId: Bytes32Schema.parse(row.target_id),
    bountyId: row.id,
    dueAt: isoDate(row.settleable_at),
    detail: 'This bounty can be settled, and the slots that filled are paid out.',
  }))
}

/** The actions that are due first, and the ones without a deadline at the end. */
function sortByDueTime(actions: NeedsAction[]): NeedsAction[] {
  return [...actions].sort((left, right) => {
    const leftTime = left.dueAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(left.dueAt)
    const rightTime = right.dueAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(right.dueAt)
    if (leftTime !== rightTime) return leftTime - rightTime
    return KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
  })
}

/** A timestamp as an ISO string, whatever the driver handed back. */
function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return date.toISOString()
}

/** A timestamp, moved by a number of seconds. */
function addSeconds(value: Date | string, seconds: bigint): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return new Date(date.getTime() + Number(seconds) * 1000).toISOString()
}
