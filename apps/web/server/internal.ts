import 'server-only'
import { z } from 'zod'
import { ResponseMeta, TargetDetail, TargetSummary } from '@sealflare/shared/schemas'
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

/**
 * What the internal service says about the freshness of the rows it read.
 *
 * The shape is the frozen `ResponseMeta` of the public API, so the two cannot drift apart. An
 * answer without a meta block is refused, because a list that hides the block it was read at
 * cannot be told apart from a list that was read a moment ago.
 */
export type InternalMeta = z.infer<typeof ResponseMeta>

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

/** How long the public API waits for the internal service. It is shorter than the deadline of the
 * request, so the chain still has time to answer within it. */
const TIMEOUT_MS = 5_000

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

/** A path always starts with a slash, so it can never be read as part of the host name. */
function pathOf(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * A request to the internal service.
 *
 * The meta of the answer is read with the frozen `ResponseMeta`, so the block a list was read at
 * and the page of that list are known to be of the shape the public API answers with. A read of
 * indexed data without a meta block is refused: an answer that does not name the block it was
 * read at cannot be told apart from an answer that was read a moment ago.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  needsMeta: boolean,
  timeoutMs: number = TIMEOUT_MS,
): Promise<InternalAnswer<T>> {
  const { INTERNAL_URL, INTERNAL_KEY } = parseInternalEnv(process.env)
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${INTERNAL_KEY}`)
  let response: Response
  try {
    response = await fetch(`${INTERNAL_URL.replace(/\/$/, '')}${pathOf(path)}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
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
  if (!response.ok || body.data === undefined || body.data === null) {
    throw new InternalServiceError('INTERNAL', 'The internal service did not answer with data.')
  }
  if (body.meta === undefined && !needsMeta) return { data: body.data as T, meta: {} }
  const meta = ResponseMeta.safeParse(body.meta)
  if (!meta.success) {
    throw new InternalServiceError('INTERNAL', 'The internal service did not answer with a meta block.')
  }
  return { data: body.data as T, meta: meta.data }
}

/**
 * Reads from the internal service. A path without a leading slash still reaches the right route.
 *
 * A read of indexed data always names the block it was read at, so the meta block is required.
 */
export async function internalGet<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<InternalAnswer<T>> {
  return request<T>(`${path}${queryString(query)}`, { method: 'GET' }, true)
}

/**
 * Reads something that is not built from indexed data.
 *
 * The queue of the sandbox and the quota of an address are not read at a block, so they name no
 * block. The meta block is therefore not required, and an answer without one is not a failure.
 */
export async function internalRead<T = unknown>(path: string): Promise<InternalAnswer<T>> {
  return request<T>(path, { method: 'GET' }, false)
}

/**
 * Writes to the internal service. The public API never writes to the chain.
 *
 * A write of the nonce or of the rate limit is not read from indexed data, so it has no block to
 * name and no meta block is required.
 *
 * A write that does more than a row of the database, like the queue of a sandbox run, is given a
 * longer deadline of its own.
 */
export async function internalPost<T = unknown>(
  path: string,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<InternalAnswer<T>> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    false,
    options.timeoutMs ?? TIMEOUT_MS,
  )
}
