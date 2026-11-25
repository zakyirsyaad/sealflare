import 'server-only'
import { z } from 'zod'
import { TargetDetail, TargetSummary } from '@sealflare/shared/schemas'
import { parseInternalEnv } from '../lib/env.schema'

/**
 * The client of the internal service, the only door to the database.
 *
 * Every answer of the internal service is an envelope. A failure of the service itself is an
 * error the caller has to handle, so it is thrown and never answered as an empty list.
 */
export class InternalServiceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InternalServiceError'
    this.code = code
  }
}

/** What the internal service says about the freshness of the rows it read. */
export interface InternalMeta {
  finalizedBlock?: string
  page?: { total: number; page: number; limit: number }
}

export interface InternalAnswer<T> {
  data: T
  meta: InternalMeta
}

/**
 * The rows of the internal service.
 *
 * The tier of the internal answer is never taken, whatever it holds: the tier is read from
 * `Core.tierOf` and never computed from the indexed rows. The placeholder only lets the rest of
 * the row be checked with the frozen schema, and it never reaches an answer.
 */
function withPlaceholderTier(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...(value as Record<string, unknown>), tier: 'UNRATED' }
}

export const InternalTargetSummary = z.preprocess(withPlaceholderTier, TargetSummary)
export const InternalTargetDetail = z.preprocess(withPlaceholderTier, TargetDetail)

/** How long the public API waits for the internal service. */
const TIMEOUT_MS = 8_000

function queryString(query: Record<string, string | number | undefined> | undefined): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(name, String(value))
  }
  const text = params.toString()
  return text.length === 0 ? '' : `?${text}`
}

async function request<T>(path: string, init: RequestInit): Promise<InternalAnswer<T>> {
  const { INTERNAL_URL, INTERNAL_KEY } = parseInternalEnv(process.env)
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${INTERNAL_KEY}`)
  let response: Response
  try {
    response = await fetch(`${INTERNAL_URL.replace(/\/$/, '')}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new InternalServiceError('INTERNAL', 'The internal service could not be reached.')
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (body === null || typeof body !== 'object') {
    throw new InternalServiceError('INTERNAL', 'The internal service did not answer with an envelope.')
  }
  if (body.success !== true) {
    const error = (body.error ?? {}) as { code?: unknown; message?: unknown }
    throw new InternalServiceError(
      typeof error.code === 'string' ? error.code : 'INTERNAL',
      typeof error.message === 'string' ? error.message : 'The internal service refused the request.',
    )
  }
  const meta = (body.meta ?? {}) as InternalMeta
  return { data: body.data as T, meta }
}

/** Reads from the internal service. A path without a leading slash is not a path. */
export async function internalGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<InternalAnswer<T>> {
  return request<T>(`${path}${queryString(query)}`, { method: 'GET' })
}

/** Writes to the internal service. The public API never writes to the chain. */
export async function internalPost<T = unknown>(path: string, body: unknown): Promise<InternalAnswer<T>> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
