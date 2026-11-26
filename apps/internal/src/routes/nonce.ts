import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AddressSchema, UintStringSchema } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, ok } from '../respond'
import { readJson } from './json'

/** A signed request may not be used after it expires, and never more than ten minutes ahead. */
export const NONCE_MAX_EXPIRY_SECONDS = 600

/** A uint256 has at most 78 decimal digits. */
const Uint256String = UintStringSchema.max(78)

const NonceUseRequest = z.object({
  address: AddressSchema,
  nonce: Uint256String,
  expiry: Uint256String,
})

const NonceStateRequest = z.object({
  address: AddressSchema,
  nonce: Uint256String,
})

export interface NonceRouteDeps {
  sql: Db
  now: () => Date
}

/** The body of a request after the schema checked it, or the answer to send instead. */
type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response }

/**
 * Reads the body of a request and checks it against the schema.
 *
 * Every nonce route reads its body the same way, so the two ways of failing are written down
 * once: a body that is not JSON, and a body that does not match the schema.
 */
async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<ParsedBody<z.infer<S>>> {
  const body = await readJson(c)
  if (!body.ok) {
    return { ok: false, response: c.json(fail('BAD_REQUEST', 'The request body is not valid JSON.'), 400) }
  }
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) {
    return { ok: false, response: c.json(fail('BAD_REQUEST', 'The request body does not match the schema.'), 400) }
  }
  return { ok: true, data: parsed.data as z.infer<S> }
}

/** Why a nonce could not be reserved. */
export type NonceRefusal = 'expired' | 'too_far_ahead' | 'already_used'

/** The answer of a reservation. */
export type NonceReservation =
  | { reserved: true }
  | { reserved: false; reason: NonceRefusal }

/**
 * Reserves a nonce for one signed request.
 *
 * The nonce has two states. `reserved` means the request may still be worked on, and `spent`
 * means the work is done and the nonce can never be used again. A reservation can be given
 * back, a spent nonce cannot, so a request that already did its work is refused here and not
 * only in the public API.
 *
 * The function is shared by the nonce route and by the sandbox route, so a request that wants to
 * run a sandbox reserves its nonce the same way as any other signed request.
 */
export async function reserveNonce(
  sql: Db,
  input: { address: string; nonce: string; expiry: string },
  now: Date,
): Promise<NonceReservation> {
  const nowSeconds = BigInt(Math.floor(now.getTime() / 1000))
  const expirySeconds = BigInt(input.expiry)
  if (expirySeconds <= nowSeconds) return { reserved: false, reason: 'expired' }
  if (expirySeconds > nowSeconds + BigInt(NONCE_MAX_EXPIRY_SECONDS)) {
    return { reserved: false, reason: 'too_far_ahead' }
  }

  const rows = await sql.query<{ nonce: string }>(
    `INSERT INTO nonces (address, nonce, expires_at, state) VALUES ($1, $2, $3, 'reserved')
     ON CONFLICT (address, nonce) DO NOTHING
     RETURNING nonce`,
    [input.address, BigInt(input.nonce).toString(), new Date(Number(expirySeconds) * 1000).toISOString()],
  )
  if (rows.length > 0) return { reserved: true }
  return { reserved: false, reason: 'already_used' }
}

/** Marks a reservation as done. A spent nonce stays spent until it expires. */
export async function commitNonce(sql: Db, input: { address: string; nonce: string }): Promise<boolean> {
  const rows = await sql.query<{ nonce: string }>(
    `UPDATE nonces SET state = 'spent' WHERE address = $1 AND nonce = $2 AND state = 'reserved'
     RETURNING nonce`,
    [input.address, BigInt(input.nonce).toString()],
  )
  return rows.length > 0
}

/**
 * Gives a reservation back, so a request that failed after the nonce was reserved can be
 * signed again. A spent nonce is never given back.
 */
export async function releaseNonce(sql: Db, input: { address: string; nonce: string }): Promise<boolean> {
  const rows = await sql.query<{ nonce: string }>(
    "DELETE FROM nonces WHERE address = $1 AND nonce = $2 AND state = 'reserved' RETURNING nonce",
    [input.address, BigInt(input.nonce).toString()],
  )
  return rows.length > 0
}

/** Reserves a nonce and answers the request. */
async function useNonce(c: Context, deps: NonceRouteDeps): Promise<Response> {
  const parsed = await parseBody(c, NonceUseRequest)
  if (!parsed.ok) return parsed.response
  const { address, nonce, expiry } = parsed.data

  const reservation = await reserveNonce(deps.sql, { address, nonce, expiry }, deps.now())
  if (reservation.reserved) return c.json(ok({ fresh: true }))
  if (reservation.reason === 'expired') return c.json(fail('BAD_REQUEST', 'The request has expired.'), 400)
  if (reservation.reason === 'too_far_ahead') {
    return c.json(fail('BAD_REQUEST', 'The request expires too far in the future.'), 400)
  }
  return c.json(ok({ fresh: false }))
}

/** Marks a reservation as done. A spent nonce stays spent until it expires. */
async function commit(c: Context, deps: NonceRouteDeps): Promise<Response> {
  const parsed = await parseBody(c, NonceStateRequest)
  if (!parsed.ok) return parsed.response
  const { address, nonce } = parsed.data

  const committed = await commitNonce(deps.sql, { address, nonce })
  return c.json(ok({ committed }))
}

/**
 * Gives a reservation back, so a request that failed after the nonce was reserved can be
 * signed again. A spent nonce is never given back.
 */
async function release(c: Context, deps: NonceRouteDeps): Promise<Response> {
  const parsed = await parseBody(c, NonceStateRequest)
  if (!parsed.ok) return parsed.response
  const { address, nonce } = parsed.data

  const released = await releaseNonce(deps.sql, { address, nonce })
  return c.json(ok({ released }))
}

/** The three nonce routes. Each one is a named handler, so each one stays short. */
export function nonceRoutes(deps: NonceRouteDeps): Hono {
  const app = new Hono()

  app.post('/use', (c) => useNonce(c, deps))
  app.post('/commit', (c) => commit(c, deps))
  app.post('/release', (c) => release(c, deps))

  return app
}
