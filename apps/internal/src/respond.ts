/** The answers the internal service gives. Every answer uses one shape, success or failure. */

/**
 * The codes the internal service answers with. The first four are its own, and the sandbox codes
 * are the ones of the public API, so the public route can pass them on without changing them.
 */
export const INTERNAL_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
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

export interface ErrorBody {
  success: false
  error: { code: InternalErrorCode; message: string; details?: unknown }
}

export function ok<T>(data: T): SuccessBody<T> {
  return { success: true, data }
}

export function fail(code: InternalErrorCode, message: string, details?: unknown): ErrorBody {
  return { success: false, error: details === undefined ? { code, message } : { code, message, details } }
}
