import { createHash, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { fail } from './respond'

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/**
 * Compares two secrets without telling how much of the offered key was right. Both sides are
 * hashed first, so an offered key of a different length is compared in the same time and can
 * never make the comparison throw.
 */
export function keysMatch(offered: string, expected: string): boolean {
  return timingSafeEqual(digest(offered), digest(expected))
}

function readBearer(header: string | undefined): string | null {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  return match?.[1] ?? null
}

/**
 * The only door into the internal service. The key never appears in an answer, in a log line or
 * in an error message, and a request without it never reaches a route.
 */
export function createInterServiceAuth(expectedKey: string): MiddlewareHandler {
  return async (c, next) => {
    const offered = readBearer(c.req.header('authorization'))
    if (!offered || !keysMatch(offered, expectedKey)) {
      return c.json(fail('UNAUTHORIZED', 'This service needs the inter-service key.'), 401)
    }
    await next()
  }
}
