import { Hono } from 'hono'
import { z } from 'zod'
import { RATE_MAX_WINDOW_SECONDS, type Db } from '../db'
import { fail, ok } from '../respond'
import { readJson } from './json'

/**
 * The caller hashes the address of the caller with a daily salt, so no raw address ever
 * reaches this table and the key changes every day.
 */
const RateTakeRequest = z.object({
  key: z.string().regex(/^[0-9a-fA-F]{32,128}$/, 'the key must be a hex hash of 32 to 128 characters'),
  limit: z.number().int().min(1).max(10_000),
  windowSeconds: z.number().int().min(1).max(RATE_MAX_WINDOW_SECONDS),
})

export interface RateRouteDeps {
  sql: Db
  now: () => Date
}

/**
 * Counts a request in the window that contains it and says whether it may pass.
 *
 * The window is fixed and aligned to the clock, so the same key always lands in the same
 * window and the count never needs to be read before it is written.
 */
export function rateRoutes(deps: RateRouteDeps): Hono {
  const app = new Hono()

  app.post('/take', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return c.json(fail('BAD_REQUEST', 'The request body is not valid JSON.'), 400)
    const parsed = RateTakeRequest.safeParse(body.value)
    if (!parsed.success) return c.json(fail('BAD_REQUEST', 'The request body does not match the schema.'), 400)

    const { key, limit, windowSeconds } = parsed.data
    const nowSeconds = Math.floor(deps.now().getTime() / 1000)
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds
    const rows = await deps.sql.query<{ count: number }>(
      `INSERT INTO rate (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate.count + 1
       RETURNING count`,
      [key.toLowerCase(), windowStart],
    )
    const count = rows[0]?.count ?? 1
    const allowed = count <= limit
    const retryAfterSeconds = allowed ? 0 : windowStart + windowSeconds - nowSeconds
    return c.json(ok({ allowed, retryAfterSeconds }))
  })

  return app
}
