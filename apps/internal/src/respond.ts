/** The answers the internal service gives. Every answer uses one shape, success or failure. */

export const INTERNAL_ERROR_CODES = ['BAD_REQUEST', 'UNAUTHORIZED', 'RESULT_NOT_CACHED', 'INTERNAL'] as const
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
