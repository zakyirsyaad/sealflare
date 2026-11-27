import { AddressSchema, type ActivityItem, type GuardianSummary } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { decimalString } from './values'
import { activityOf } from './activity'

/**
 * The read model of the guardians the Core knows.
 *
 * A guardian with a penalty that was never charged is marked, because the score on the chain
 * still counts the penalty that is waiting. The flag is read from the indexed rows, so it can
 * never disagree with the score the chain reports.
 */

/** The columns of a guardian row, as Postgres hands them back. */
interface GuardianRow {
  address: string
  score: number
  weight: number
  attestations: number
  pending_penalties: number
  created_at_block: unknown
}

/** The summary of one guardian row. */
export function summaryOf(row: GuardianRow): GuardianSummary {
  return {
    address: AddressSchema.parse(row.address),
    score: row.score,
    weight: row.weight,
    attestations: row.attestations,
    penaltyPending: row.pending_penalties > 0,
  }
}

/**
 * One page of the guardian list.
 *
 * The guardians with the highest score come first, because the score is the standing of a
 * Guardian. The votes and the address break a tie, so two guardians with the same score keep
 * the same place on every page.
 */
export async function listGuardians(
  sql: Db,
  page: number,
  limit: number,
): Promise<{ items: GuardianSummary[]; total: number }> {
  const total = await countGuardians(sql)
  const rows = await sql.query<GuardianRow>(
    `SELECT address, score, weight, attestations, pending_penalties, created_at_block
     FROM guardians ORDER BY score DESC, attestations DESC, address ASC LIMIT $1 OFFSET $2`,
    [limit, (page - 1) * limit],
  )
  return { items: rows.map(summaryOf), total }
}

/** How many guardians the chain has. */
async function countGuardians(sql: Db): Promise<number> {
  const rows = await sql.query<{ total: unknown }>('SELECT count(*)::int AS total FROM guardians')
  return Number(decimalString(rows[0]?.total ?? 0))
}

/**
 * The detail of one guardian, or null when the database does not have it.
 *
 * A guardian that never attested is not a row yet, so the answer is the empty one instead of a
 * guardian that was invented.
 */
export async function guardianDetail(sql: Db, address: string): Promise<unknown | null> {
  const rows = await sql.query<GuardianRow>(
    `SELECT address, score, weight, attestations, pending_penalties, created_at_block
     FROM guardians WHERE address = $1`,
    [address.toLowerCase()],
  )
  const row = rows[0]
  if (!row) return null
  const history = await activityOf(sql, row.address)
  return {
    ...summaryOf(row),
    createdAtBlock: decimalString(row.created_at_block),
    history: history.items as ActivityItem[],
  }
}
