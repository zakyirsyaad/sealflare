import { AddressSchema, Bytes32Schema, type ChallengeSummary } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { decimalString } from './targets'

/**
 * The read model of the disputes the Court brought.
 *
 * The phase of a row is the phase the dispute is in right now, not the phase it was in when the
 * last event arrived. The contract decides the phase the same way: the outcome closes it, the
 * windows move it from commit to reveal, and the end of the reveal window leaves it waiting to
 * be closed.
 */

/** The phase of a dispute. */
export type ChallengePhase = 'COMMIT' | 'REVEAL' | 'AWAITING_CLOSE' | 'CLOSED'

/** The columns of a challenge row, as Postgres hands them back. */
interface ChallengeRow {
  id: string
  target_id: string
  label: string
  challenger: string
  outcome: string
  flags: number
  short_proof: string
  evidence_uri: string | null
  counter_evidence_uri: string | null
  commits: number
  reveals: number
  commit_ends_at: Date | string | null
  reveal_ends_at: Date | string | null
  created_at_block: unknown
  uphold_weight: number
  reject_weight: number
  publisher: string | null
}

const CHALLENGE_COLUMNS = `c.id, c.target_id, c.label, c.challenger, c.outcome, c.flags, c.short_proof,
       c.evidence_uri, c.counter_evidence_uri, c.commits, c.reveals, c.commit_ends_at, c.reveal_ends_at,
       c.created_at_block, c.uphold_weight, c.reject_weight, t.publisher`

/** The newest dispute first. The id is a number on the chain, so it is sorted as one. */
const ORDER = 'ORDER BY c.created_at_block DESC, c.id::numeric DESC'

/**
 * The phase of a dispute, computed the way the Court computes it.
 *
 * The moment is passed in, so the answer is the same for the same moment.
 */
export function phaseOf(
  challenge: { outcome: string; commitEndsAt: Date; revealEndsAt: Date },
  now: Date,
): ChallengePhase {
  if (challenge.outcome !== 'PENDING') return 'CLOSED'
  if (now.getTime() < challenge.commitEndsAt.getTime()) return 'COMMIT'
  if (now.getTime() < challenge.revealEndsAt.getTime()) return 'REVEAL'
  return 'AWAITING_CLOSE'
}

/** The filters of the dispute list. */
export interface ChallengeFilters {
  targetId?: string
}

/** The summary of one dispute row. */
export function summaryOf(row: ChallengeRow, now: Date): ChallengeSummary {
  const windows = windowsOf(row)
  return {
    id: row.id,
    targetId: Bytes32Schema.parse(row.target_id),
    label: row.label,
    challenger: AddressSchema.parse(row.challenger),
    phase: phaseOf({ outcome: row.outcome, ...windows }, now),
    outcome: row.outcome as ChallengeSummary['outcome'],
    commitEndsAt: windows.commitEndsAt.toISOString(),
    revealEndsAt: windows.revealEndsAt.toISOString(),
    commits: row.commits,
    reveals: row.reveals,
  }
}

/**
 * One page of the dispute list.
 */
export async function listChallenges(
  sql: Db,
  filters: ChallengeFilters,
  page: number,
  limit: number,
  now: Date,
): Promise<{ items: ChallengeSummary[]; total: number }> {
  const total = await countChallenges(sql, filters)
  const rows = await sql.query<ChallengeRow>(
    `SELECT ${CHALLENGE_COLUMNS} FROM challenges c JOIN targets t ON t.target_id = c.target_id
     WHERE ($1::text IS NULL OR c.target_id = $1) ${ORDER}
     LIMIT $2 OFFSET $3`,
    [filters.targetId ?? null, limit, (page - 1) * limit],
  )
  return { items: rows.map((row) => summaryOf(row, now)), total }
}

/** How many disputes the filters match. */
async function countChallenges(sql: Db, filters: ChallengeFilters): Promise<number> {
  const rows = await sql.query<{ total: unknown }>(
    'SELECT count(*)::int AS total FROM challenges c WHERE ($1::text IS NULL OR c.target_id = $1)',
    [filters.targetId ?? null],
  )
  return Number(decimalString(rows[0]?.total ?? 0))
}

/**
 * The detail of one dispute, or null when the database does not have it.
 *
 * The direction of a vote is only known after the juror revealed it, so it stays empty until
 * then. During the commit phase every direction stays empty, whatever the rows hold.
 */
export async function challengeDetail(sql: Db, id: string, now: Date): Promise<unknown | null> {
  const rows = await sql.query<ChallengeRow>(
    `SELECT ${CHALLENGE_COLUMNS} FROM challenges c JOIN targets t ON t.target_id = c.target_id
     WHERE c.id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) return null

  const windows = windowsOf(row)
  const phase = phaseOf({ outcome: row.outcome, ...windows }, now)
  const jurors = await listJurors(sql, id, phase)
  const payouts = await listPayouts(sql, id)
  // The contract does not require an evidence URI, but the frozen answer does. A dispute that was
  // opened without one therefore does not fit the answer, and the route refuses it instead of
  // sending an empty URI. The application always pins the evidence before it opens a dispute.
  const evidenceURI = row.evidence_uri ?? ''

  return {
    ...summaryOf(row, now),
    flags: row.flags,
    shortProof: row.short_proof,
    evidenceURI,
    // The contract does not check the URI of a reply, so an empty one means no counter-evidence.
    counterEvidenceURI: row.counter_evidence_uri === null || row.counter_evidence_uri === '' ? null : row.counter_evidence_uri,
    publisher: row.publisher === null ? null : AddressSchema.parse(row.publisher),
    jurors,
    upholdWeight: row.uphold_weight,
    rejectWeight: row.reject_weight,
    payouts,
  }
}

/**
 * The jury of a dispute.
 *
 * A direction is only shown for a vote that was revealed, and never during the commit phase.
 */
async function listJurors(sql: Db, challengeId: string, phase: ChallengePhase): Promise<unknown[]> {
  const rows = await sql.query<{ address: string; weight: number; revealed: boolean; uphold: boolean | null }>(
    `SELECT address, weight, revealed, uphold FROM jurors WHERE challenge_id = $1 ORDER BY address ASC`,
    [challengeId],
  )
  return rows.map((row) => ({
    address: AddressSchema.parse(row.address),
    weight: row.weight,
    revealed: row.revealed,
    uphold: phase === 'COMMIT' || !row.revealed ? null : row.uphold,
  }))
}

/**
 * The payouts of one dispute.
 *
 * The rows hold the payouts of that dispute alone, so a dispute never shows the money of
 * another one.
 */
async function listPayouts(sql: Db, challengeId: string): Promise<unknown[]> {
  const rows = await sql.query<{ recipient: string; amount: unknown }>(
    'SELECT recipient, amount FROM payouts WHERE challenge_id = $1 ORDER BY amount DESC, recipient ASC',
    [challengeId],
  )
  return rows.map((row) => ({
    recipient: AddressSchema.parse(row.recipient),
    amount: decimalString(row.amount),
  }))
}

/**
 * The two windows of a dispute.
 *
 * A row without its windows cannot be read, so the answer is refused instead of a window that
 * was invented.
 */
function windowsOf(row: ChallengeRow): { commitEndsAt: Date; revealEndsAt: Date } {
  const commitEndsAt = row.commit_ends_at === null ? null : new Date(row.commit_ends_at)
  const revealEndsAt = row.reveal_ends_at === null ? null : new Date(row.reveal_ends_at)
  if (commitEndsAt === null || revealEndsAt === null || Number.isNaN(commitEndsAt.getTime())) {
    throw new Error(`the dispute ${row.id} has no windows`)
  }
  if (Number.isNaN(revealEndsAt.getTime())) throw new Error(`the dispute ${row.id} has no windows`)
  return { commitEndsAt, revealEndsAt }
}
