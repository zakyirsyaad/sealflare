import 'server-only'
import { createHash } from 'node:crypto'
import { parseInternalEnv } from '../lib/env.schema'
import { internalPost } from './internal'

/**
 * The rate limits of the public API. A scan is expensive, so it is limited per network, and an
 * evidence upload is limited per address, because it costs money to store.
 */
export type RateKind = 'scan' | 'evidence'

const LIMITS: Record<RateKind, { limit: number; windowSeconds: number }> = {
  scan: { limit: 20, windowSeconds: 600 },
  evidence: { limit: 30, windowSeconds: 3600 },
}

export interface RateLimit {
  allowed: boolean
  retryAfterSeconds: number
}

/**
 * The key of a caller is hashed, so the database never holds a raw address, and the salt changes
 * every day, so the same caller is not counted across days.
 */
function rateKey(identity: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${identity.toLowerCase()}`).digest('hex')
}

/** The daily salt. It comes from the inter-service key, which never leaves the server. */
function dailySalt(): string {
  const { INTERNAL_KEY } = parseInternalEnv(process.env)
  const day = new Date().toISOString().slice(0, 10)
  return createHash('sha256').update(`${INTERNAL_KEY}:${day}`).digest('hex')
}

/**
 * Counts one request of the caller in the window that contains it.
 *
 * The count lives in the internal service, so it survives a restart of the public API and is
 * shared by every instance of it.
 */
export async function takeRateLimit(kind: RateKind, identity: string): Promise<RateLimit> {
  const rule = LIMITS[kind]
  const answer = await internalPost<RateLimit>('/rate/take', {
    key: rateKey(identity, dailySalt()),
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  })
  return {
    allowed: answer.data.allowed,
    retryAfterSeconds: answer.data.retryAfterSeconds,
  }
}
