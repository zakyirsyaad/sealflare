/** The answers the internal service gives. Every answer uses one shape, success or failure. */

import { z } from 'zod'
import { ResponseMeta, UintStringSchema } from '@sealflare/shared/schemas'

/**
 * The meta of an answer that comes from indexed data.
 *
 * The frozen schema leaves the block optional, because a plain answer does not need it. An
 * answer built from indexed data always names the block it was read at, so the type here asks
 * for it and keeps the frozen shape for the rest.
 */
export const ReadMeta = ResponseMeta.extend({ finalizedBlock: UintStringSchema })
export type ReadMeta = z.infer<typeof ReadMeta>

/**
 * The codes the internal service answers with. The first five are its own, and the sandbox codes
 * are the ones of the public API, so the public route can pass them on without changing them.
 */
export const INTERNAL_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RESULT_NOT_CACHED',
  'INTERNAL',
  'SIGNATURE_INVALID',
  'SIGNATURE_EXPIRED',
  'NOT_AGENT_ID_HOLDER',
  'QUOTA_EXHAUSTED',
  'SANDBOX_PAUSED',
  'RUN_NOT_FOUND',
] as const
export type InternalErrorCode = (typeof INTERNAL_ERROR_CODES)[number]

export interface SuccessBody<T> {
  success: true
  data: T
}

/** An answer that also names how fresh the data is. */
export interface SuccessBodyWithMeta<T> extends SuccessBody<T> {
  meta: ReadMeta
}

export interface ErrorBody {
  success: false
  error: { code: InternalErrorCode; message: string; details?: unknown }
}

export function ok<T>(data: T): SuccessBody<T> {
  return { success: true, data }
}

/**
 * An answer built from indexed data. It names the last final block the indexer has read, so the
 * caller can tell how fresh the rows are.
 */
export function okWithMeta<T>(data: T, meta: ReadMeta): SuccessBodyWithMeta<T> {
  return { success: true, data, meta }
}

export function fail(code: InternalErrorCode, message: string, details?: unknown): ErrorBody {
  return { success: false, error: details === undefined ? { code, message } : { code, message, details } }
}
