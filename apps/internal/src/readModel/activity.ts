import { XP, weightOf } from '@sealflare/shared/rules'
import { Bytes32Schema, type ActivityItem } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { decimalString } from './values'
import { needsActionFor } from './needsAction'

/**
 * The read model of what an account did and what it still has to do.
 *
 * The balance is the sum of the credits minus the sum of the withdrawals, so it is read from the
 * ledger of the account and never kept as a number that can drift.
 */

/** How far the scan for the next weight goes. A score further below the first weight than this has none to name. */
const MAX_SCAN_STEPS = 100_000

/** What the activity of one account holds. */
export interface ActivityReading {
  items: ActivityItem[]
  balance: string
  score: number
  weight: number
  toNextWeight: number | null
}

/**
 * The whole activity of one account.
 *
 * The moment is passed in, so the deadlines of the actions are the same for every caller.
 */
export async function activityFor(sql: Db, address: string, now: Date): Promise<unknown> {
  const lower = address.toLowerCase()
  const needsAction = await needsActionFor(sql, lower, now)
  const reading = await activityOf(sql, lower)
  return {
    needsAction,
    balance: reading.balance,
    score: reading.score,
    weight: reading.weight,
    toNextWeight: reading.toNextWeight,
    history: reading.items,
  }
}

/**
 * The history of one account, with its balance and its standing.
 *
 * The history is the newest first, and it holds every kind the screen shows: the votes of the
 * account, its seats in a jury, the disputes it opened, the bounties it asked for and the bonds
 * it posted.
 */
export async function activityOf(sql: Db, address: string): Promise<ActivityReading> {
  const lower = address.toLowerCase()
  const balance = await readBalance(sql, lower)
  const guardian = await readGuardian(sql, lower)
  const items = [
    ...(await readAttestations(sql, lower)),
    ...(await readJurors(sql, lower)),
    ...(await readChallenges(sql, lower)),
    ...(await readBounties(sql, lower)),
    ...(await readBonds(sql, lower)),
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))

  return {
    items,
    balance,
    score: guardian?.score ?? 0,
    weight: guardian?.weight ?? 0,
    toNextWeight: toNextWeight(guardian?.score ?? 0),
  }
}

/** The balance of an account: the credits minus the withdrawals. */
async function readBalance(sql: Db, address: string): Promise<string> {
  const rows = await sql.query<{ balance: unknown }>(
    `SELECT COALESCE(sum(CASE WHEN kind = 'CREDIT' THEN amount ELSE -amount END), 0) AS balance
     FROM balances WHERE address = $1`,
    [address],
  )
  return decimalString(rows[0]?.balance ?? 0)
}

/** The row of a guardian, when the chain knows one. */
async function readGuardian(
  sql: Db,
  address: string,
): Promise<{ score: number; weight: number } | null> {
  const rows = await sql.query<{ score: number; weight: number }>(
    'SELECT score, weight FROM guardians WHERE address = $1',
    [address],
  )
  return rows[0] ?? null
}

/**
 * How many points are left to the next weight.
 *
 * The thresholds are not copied here: the next weight is the first score above this one for which
 * `weightOf` of the frozen rules gives a larger weight, so a change of a threshold there changes
 * the distance here with it. A guardian with the highest weight has no next weight.
 */
export function toNextWeight(score: number): number | null {
  if (!Number.isInteger(score)) return null
  const weight = weightOf(score)
  if (weight === weightOf(Number.MAX_SAFE_INTEGER)) return null
  for (let step = 1; step <= MAX_SCAN_STEPS; step += 1) {
    if (weightOf(score + step) > weight) return step
  }
  return null
}

/** The votes of an account. */
async function readAttestations(sql: Db, address: string): Promise<ActivityItem[]> {
  const rows = await sql.query<{
    target_id: string
    label: string
    verdict: string
    settled_xp: number | null
    at: Date | string
  }>(
    `SELECT a.target_id, t.label, a.verdict, a.settled_xp, a.at
     FROM attestations a JOIN targets t ON t.target_id = a.target_id
     WHERE a.guardian = $1`,
    [address],
  )
  return rows.map((row) => ({
    kind: 'attestation',
    targetId: Bytes32Schema.parse(row.target_id),
    label: row.label,
    result: row.verdict,
    xp: row.settled_xp,
    at: isoDate(row.at),
  }))
}

/**
 * The seats of an account in a jury.
 *
 * A vote that was not revealed yet has no direction, so the history never shows one either.
 *
 * The XP follows the contract: a juror whose revealed vote is on the side the verdict names earns
 * the majority XP. A tie, an expiry, a dispute still open and a vote that was never revealed earn
 * nothing.
 */
async function readJurors(sql: Db, address: string): Promise<ActivityItem[]> {
  const rows = await sql.query<{
    target_id: string
    label: string
    revealed: boolean
    uphold: boolean | null
    outcome: string
    at: Date | string
  }>(
    `SELECT c.target_id, t.label, c.outcome, j.revealed, j.uphold, j.at
     FROM jurors j JOIN challenges c ON c.id = j.challenge_id
     JOIN targets t ON t.target_id = c.target_id
     WHERE j.address = $1`,
    [address],
  )
  return rows.map((row) => ({
    kind: 'juror',
    targetId: Bytes32Schema.parse(row.target_id),
    label: row.label,
    result: resultOfVote(row.revealed, row.uphold),
    xp: xpOfVote(row.outcome, row.revealed, row.uphold),
    at: isoDate(row.at),
  }))
}

/** The XP of a seat: the majority XP when the revealed vote is on the winning side. */
function xpOfVote(outcome: string, revealed: boolean, uphold: boolean | null): number | null {
  if (!revealed) return null
  if (outcome === 'UPHELD' && uphold === true) return XP.JUROR_MAJORITY
  if (outcome === 'REJECTED' && uphold === false) return XP.JUROR_MAJORITY
  return null
}

/** What a seat in a jury says. A vote that was not revealed yet only says that it was cast. */
function resultOfVote(revealed: boolean, uphold: boolean | null): string {
  if (!revealed) return 'Commit cast'
  return uphold === true ? 'Vote upheld' : 'Vote rejected'
}

/**
 * The disputes an account opened.
 *
 * The XP of a dispute comes from the rules: winning it is worth five points and losing it costs
 * five. A dispute that ended in a tie or in an expiry costs nothing.
 */
async function readChallenges(sql: Db, address: string): Promise<ActivityItem[]> {
  const rows = await sql.query<{
    target_id: string
    label: string
    outcome: string
    created_at: Date | string | null
  }>(
    `SELECT c.target_id, t.label, c.outcome, c.created_at
     FROM challenges c JOIN targets t ON t.target_id = c.target_id
     WHERE c.challenger = $1`,
    [address],
  )
  return rows
    .filter((row) => row.created_at !== null)
    .map((row) => ({
      kind: 'challenge',
      targetId: Bytes32Schema.parse(row.target_id),
      label: row.label,
      result: resultOfChallenge(row.outcome),
      xp: xpOfChallenge(row.outcome),
      at: isoDate(row.created_at as Date | string),
    }))
}

/** What a dispute ended in. */
function resultOfChallenge(outcome: string): string {
  if (outcome === 'UPHELD') return 'Upheld'
  if (outcome === 'REJECTED') return 'Rejected'
  if (outcome === 'TIED') return 'Tied'
  if (outcome === 'EXPIRED') return 'Expired'
  return 'Open'
}

/**
 * The XP a dispute is worth for the challenger.
 *
 * The contract only changes the score of a dispute that ended in a verdict. A tie and an expiry
 * change nothing, so the history shows no XP for them either.
 */
function xpOfChallenge(outcome: string): number | null {
  if (outcome === 'UPHELD') return XP.CHALLENGER_WON
  if (outcome === 'REJECTED') return XP.CHALLENGER_LOST
  return null
}

/** The bounties an account asked for. */
async function readBounties(sql: Db, address: string): Promise<ActivityItem[]> {
  const rows = await sql.query<{
    target_id: string
    label: string
    settled: boolean
    created_at: Date | string
  }>(
    `SELECT b.target_id,
       COALESCE(b.label, (SELECT t.label FROM targets t WHERE t.target_id = b.target_id), b.target_id) AS label,
       b.settled, b.created_at
     FROM bounties b WHERE b.requester = $1`,
    [address],
  )
  return rows.map((row) => ({
    kind: 'bounty',
    targetId: Bytes32Schema.parse(row.target_id),
    label: row.label,
    result: row.settled ? 'Bounty settled' : 'Bounty created',
    xp: null,
    at: isoDate(row.created_at),
  }))
}

/** The bonds an account posted. */
async function readBonds(sql: Db, address: string): Promise<ActivityItem[]> {
  const rows = await sql.query<{
    target_id: string
    label: string
    amount: unknown
    requested_at: Date | string | null
    finalized_at: Date | string | null
    created_at: Date | string | null
  }>(
    `SELECT b.target_id, t.label, b.amount, b.requested_at, b.finalized_at, b.created_at
     FROM bonds b JOIN targets t ON t.target_id = b.target_id
     WHERE b.depositor = $1`,
    [address],
  )
  return rows
    .filter((row) => row.created_at !== null)
    .map((row) => ({
      kind: 'bond',
      targetId: Bytes32Schema.parse(row.target_id),
      label: row.label,
      result: resultOfBond(row),
      xp: null,
      at: isoDate(row.created_at as Date | string),
    }))
}

/** The state a bond is in. */
function resultOfBond(row: {
  amount: unknown
  requested_at: Date | string | null
  finalized_at: Date | string | null
}): string {
  if (row.finalized_at !== null) return 'Bond finalized'
  if (row.requested_at !== null) return 'Withdrawal requested'
  if (decimalString(row.amount) === '0') return 'Bond slashed'
  return 'Bond deposited'
}

/** A timestamp as an ISO string, whatever the driver handed back. */
function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return date.toISOString()
}
