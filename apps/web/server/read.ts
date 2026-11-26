import 'server-only'
import { z } from 'zod'
import { fail, failUnexpected, ok } from './respond'
import { internalGet, InternalServiceError } from './internal'

/**
 * The answers of the read routes that come from the indexed rows.
 *
 * The internal service is the only door to the database. A failure of that service is an error
 * and never an empty list, so a reader never sees a registry that looks empty because the
 * service was down. Every answer names the last final block the rows were read at, because a
 * row that is not final may still change.
 */

/** The default size of a page. */
export const DEFAULT_LIMIT = 20

/** The page of a list, as the query of the request names it. */
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** The page of a list. */
export interface Page {
  page: number
  limit: number
}

/**
 * Reads the page of the query, or the reason it cannot be read.
 *
 * A query that names no page holds the first page of the default size.
 */
export function readPage(url: URL): { ok: true; value: Page } | { ok: false } {
  const params = url.searchParams
  const parsed = PageQuery.safeParse({ page: readNumber(params, 'page'), limit: readNumber(params, 'limit') })
  if (!parsed.success) return { ok: false }
  return { ok: true, value: { page: parsed.data.page ?? 1, limit: parsed.data.limit ?? DEFAULT_LIMIT } }
}

/** A number of the query, or nothing when the query does not hold one. */
function readNumber(params: URLSearchParams, name: string): number | undefined {
  const text = params.get(name)
  if (text === null || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

/**
 * Reads a list from the internal service and answers it with the page of the meta.
 *
 * The rows are checked with the frozen schema of the list, so a row that does not fit is never
 * answered.
 */
export async function readList<T>(options: {
  path: string
  query?: Record<string, string | number | undefined>
  item: z.ZodType<T>
  message: string
  page: Page
}): Promise<Response> {
  try {
    const answer = await internalGet<{ items: unknown[] }>(options.path, options.query)
    const items = options.item.array().safeParse(answer.data.items)
    const total = answer.meta.page?.total
    const finalizedBlock = answer.meta.finalizedBlock
    if (!items.success || total === undefined || finalizedBlock === undefined) {
      return fail('INTERNAL', options.message, 503)
    }
    return ok(
      { items: items.data },
      { finalizedBlock, page: { total, page: options.page.page, limit: options.page.limit } },
    )
  } catch (error) {
    if (error instanceof InternalServiceError) return fail('INTERNAL', options.message, 503)
    return failUnexpected(options.message, error)
  }
}

/**
 * Reads one row from the internal service and answers it.
 *
 * A row that the service does not have is not found, and a row that does not fit the frozen
 * schema is an error, never a row that was made up.
 */
export async function readOne<T>(options: {
  path: string
  data: z.ZodType<T>
  message: string
  notFound: string
  /** The row is prepared before it is checked, so a route may hide a field it may not show. */
  prepare?: (value: unknown) => unknown
}): Promise<Response> {
  try {
    const answer = await internalGet<unknown>(options.path)
    const finalizedBlock = answer.meta.finalizedBlock
    if (finalizedBlock === undefined) return fail('INTERNAL', options.message, 503)
    const prepared = options.prepare === undefined ? answer.data : options.prepare(answer.data)
    const parsed = options.data.safeParse(prepared)
    if (!parsed.success) return fail('INTERNAL', options.message, 503)
    return ok(parsed.data, { finalizedBlock })
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'NOT_FOUND') return fail('NOT_FOUND', options.notFound, 404)
      return fail('INTERNAL', options.message, 503)
    }
    return failUnexpected(options.message, error)
  }
}
