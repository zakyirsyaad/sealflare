import { AddressSchema, Bytes32Schema, VerdictSchema, type BountySummary } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { decimalString } from './targets'

/**
 * The read model of the bounties the Vault brought.
 *
 * The filled slots are the rows of the bounty, so the number of filled slots is read from the
 * database and never counted from the events that filled them.
 */

/** The columns of a bounty row, as Postgres hands them back. */
interface BountyRow {
  id: string
  target_id: string
  label: string
  requester: string
  slots: number
  amount: unknown
  created_at: Date | string
  settleable_at: Date | string | null
  settled: boolean
  filled: number
}

/** The summary of one bounty row. */
export function summaryOf(row: BountyRow): BountySummary {
  return {
    id: row.id,
    targetId: Bytes32Schema.parse(row.target_id),
    label: row.label,
    requester: AddressSchema.parse(row.requester),
    slots: row.slots,
    filled: row.filled,
    amount: decimalString(row.amount),
    createdAt: isoDate(row.created_at),
    settleableAt: row.settleable_at === null ? null : isoDate(row.settleable_at),
    settled: row.settled,
  }
}

/** The filters of the bounty list. */
export interface BountyFilters {
  targetId?: string
  requester?: string
}

/**
 * One page of the bounty list.
 *
 * The open bounties come first, because a bounty that can still be filled is the one a reader
 * can do something with.
 */
export async function listBounties(
  sql: Db,
  filters: BountyFilters,
  page: number,
  limit: number,
): Promise<{ items: BountySummary[]; total: number }> {
  const total = await countBounties(sql, filters)
  const rows = await sql.query<BountyRow>(
    `SELECT b.id, b.target_id, b.label, b.requester, b.slots, b.amount, b.created_at, b.settleable_at,
       b.settled, (SELECT count(*)::int FROM bounty_fillers f WHERE f.bounty_id = b.id) AS filled
     FROM bounties b
     WHERE ($1::text IS NULL OR b.target_id = $1) AND ($2::text IS NULL OR b.requester = $2)
     ORDER BY b.settled ASC, b.created_at DESC, b.id DESC
     LIMIT $3 OFFSET $4`,
    [filters.targetId ?? null, filters.requester ?? null, limit, (page - 1) * limit],
  )
  return { items: rows.map(summaryOf), total }
}

/** How many bounties the filters match. */
async function countBounties(sql: Db, filters: BountyFilters): Promise<number> {
  const rows = await sql.query<{ total: unknown }>(
    `SELECT count(*)::int AS total FROM bounties b
     WHERE ($1::text IS NULL OR b.target_id = $1) AND ($2::text IS NULL OR b.requester = $2)`,
    [filters.targetId ?? null, filters.requester ?? null],
  )
  return Number(decimalString(rows[0]?.total ?? 0))
}

/**
 * The detail of one bounty, or null when the database does not have it.
 *
 * The fillers are the rows of the bounty, with the verdict each of them cast.
 */
export async function bountyDetail(sql: Db, id: string): Promise<unknown | null> {
  const rows = await sql.query<BountyRow>(
    `SELECT b.id, b.target_id, b.label, b.requester, b.slots, b.amount, b.created_at, b.settleable_at,
       b.settled, (SELECT count(*)::int FROM bounty_fillers f WHERE f.bounty_id = b.id) AS filled
     FROM bounties b WHERE b.id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) return null

  const fillers = await sql.query<{ guardian: string; verdict: string }>(
    'SELECT guardian, verdict FROM bounty_fillers WHERE bounty_id = $1 ORDER BY at ASC, guardian ASC',
    [id],
  )
  return {
    ...summaryOf(row),
    fillers: fillers.map((filler) => ({
      guardian: AddressSchema.parse(filler.guardian),
      verdict: VerdictSchema.parse(filler.verdict),
    })),
  }
}

/** A timestamp as an ISO string, whatever the driver handed back. */
function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return date.toISOString()
}
