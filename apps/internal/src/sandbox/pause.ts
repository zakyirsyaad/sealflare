import type { Db } from '../db'
import { utcDay } from './quota'

/**
 * The pause of the sandbox.
 *
 * The worker has a global daily cost limit. When it is reached, no run of the day can start, so
 * the service pauses the sandbox for the rest of the day and says so instead of queueing runs
 * that would never start.
 */
export interface PauseDeps {
  sql: Db
  now: () => Date
}

/** Whether the sandbox is paused today. */
export async function isPaused(deps: PauseDeps): Promise<boolean> {
  const rows = await deps.sql.query<{ day: string }>('SELECT day FROM sandbox_pause WHERE day = $1::date', [
    utcDay(deps.now()),
  ])
  return rows.length > 0
}

/**
 * Pauses the sandbox for the rest of the day.
 *
 * The day is the key, so the pause ends by itself when the day ends and needs no cleanup.
 */
export async function pauseSandbox(deps: PauseDeps, reason: string): Promise<void> {
  await deps.sql.query(
    `INSERT INTO sandbox_pause (day, reason, paused_at) VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET reason = EXCLUDED.reason, paused_at = EXCLUDED.paused_at`,
    [utcDay(deps.now()), reason, deps.now().toISOString()],
  )
}
