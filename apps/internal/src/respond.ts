/** The answers the internal service gives. Every answer uses one shape, success or failure. */

/**
 * The meta of an answer: how fresh the data is, and the page of a list.
 *
 * The frozen schema leaves both optional, because a plain answer does not need them. An answer
 * built from indexed data always names the block it was read at, so the type here asks for it.
 */
export interface ReadMeta {
  finalizedBlock: string
  page?: { total: number; page: number; limit: number }
}

export const INTERNAL_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RESULT_NOT_CACHED',
  'INTERNAL',
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
