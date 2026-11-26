import { CONSTANTS } from '@sealflare/shared/rules'
import type { Db } from '../db'

/**
 * The daily sandbox quota of one address.
 *
 * Five runs a day, counted in UTC. The count is taken when the run enters the queue, and it is
 * only given back when the failure was ours and not the skill's own content.
 */
export interface QuotaDeps {
  sql: Db
  now: () => Date
}

/** The UTC day a moment belongs to. The quota resets at midnight UTC. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** The moment the quota of a day is given back. */
export function resetsAt(now: Date): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return new Date(next).toISOString()
}

/**
 * Takes one run of the quota.
 *
 * The row is written in one statement, so two requests that arrive together cannot both take the
 * last run. The check constraint of the table is the second guard: it refuses a count above the
 * limit even if the statement is wrong.
 */
export async function takeQuota(deps: QuotaDeps, address: string): Promise<{ taken: boolean; left: number }> {
  const day = utcDay(deps.now())
  const rows = await deps.sql.query<{ used: number }>(
    `INSERT INTO sandbox_quota (address, day, used) VALUES ($1, $2::date, 1)
     ON CONFLICT (address, day) DO UPDATE SET used = sandbox_quota.used + 1
     WHERE sandbox_quota.used < $3
     RETURNING used`,
    [address, day, CONSTANTS.SANDBOX_DAILY_RUNS],
  )
  const row = rows[0]
  if (row === undefined) return { taken: false, left: 0 }
  return { taken: true, left: CONSTANTS.SANDBOX_DAILY_RUNS - row.used }
}

/**
 * Gives one run of the quota back.
 *
 * The run row is marked first and only the first mark gives the quota back, so a run that is
 * failed twice never returns two runs.
 */
export async function refundQuota(deps: QuotaDeps, runId: string): Promise<boolean> {
  return deps.sql.transaction(async tx => {
    const rows = await tx.query<{ address: string; quota_day: string }>(
      `UPDATE sandbox_runs SET quota_refunded = true
       WHERE run_id = $1 AND quota_refunded = false AND quota_day IS NOT NULL
       RETURNING address, quota_day::text AS quota_day`,
      [runId],
    )
    const row = rows[0]
    if (row === undefined) return false
    await tx.query('UPDATE sandbox_quota SET used = GREATEST(used - 1, 0) WHERE address = $1 AND day = $2::date', [
      row.address,
      row.quota_day,
    ])
    return true
  })
}

/** The runs an address has left today. */
export async function quotaLeft(deps: QuotaDeps, address: string): Promise<number> {
  const rows = await deps.sql.query<{ used: number }>(
    'SELECT used FROM sandbox_quota WHERE address = $1 AND day = $2::date',
    [address, utcDay(deps.now())],
  )
  const used = rows[0]?.used ?? 0
  return Math.max(0, CONSTANTS.SANDBOX_DAILY_RUNS - used)
}
