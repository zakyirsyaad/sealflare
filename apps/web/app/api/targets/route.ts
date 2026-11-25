import { z } from 'zod'
import { ListQuery } from '@sealflare/shared/schemas'
import { fail, failUnexpected, ok } from '../../../server/respond'
import { internalGet, InternalServiceError, InternalTargetSummary } from '../../../server/internal'
import { withTiers } from '../../../server/tier'

/** The default size of a page. */
const DEFAULT_LIMIT = 20

/**
 * The query of the target list. The frozen `ListQuery` decides what a query may hold, and the
 * text of the query is turned into the numbers it names before it is checked.
 */
function readQuery(url: URL): { ok: true; value: z.infer<typeof ListQuery> } | { ok: false } {
  const params = url.searchParams
  const parsed = ListQuery.safeParse({
    page: readNumber(params.get('page')),
    limit: readNumber(params.get('limit')),
    address: params.get('address') ?? undefined,
    type: params.get('type') ?? undefined,
    tier: params.get('tier') ?? undefined,
  })
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false }
}

/** A number of the query, or nothing when the query does not hold one. */
function readNumber(text: string | null): number | undefined {
  if (text === null || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

/**
 * The list of the targets.
 *
 * Without a tier filter the page comes from the internal service and only the tier of the rows
 * of that page is filled. With a tier filter every candidate is read, because the tier is not
 * in the indexed rows and the page cannot be cut before the tier is known.
 */
export async function GET(request: Request): Promise<Response> {
  const query = readQuery(new URL(request.url))
  if (!query.ok) return fail('BAD_REQUEST', 'The query of the target list is not valid.', 400)
  const { page, limit, address, type, tier } = query.value
  const current = page ?? 1
  const size = limit ?? DEFAULT_LIMIT
  try {
    if (tier === undefined) {
      const answer = await internalGet<{ items: unknown[] }>('/targets', { page: current, limit: size, address, type })
      const items = InternalTargetSummary.array().safeParse(answer.data.items)
      if (!items.success) return fail('INTERNAL', 'The indexed targets cannot be read.', 503)
      const filled = await withTiers(items.data)
      if (filled === null) return fail('INTERNAL', 'The trust tier cannot be read.', 503)
      const total = answer.meta.page?.total ?? filled.length
      return ok({ items: filled }, { finalizedBlock: answer.meta.finalizedBlock, page: { total, page: current, limit: size } })
    }
    const answer = await internalGet<{ items: unknown[] }>('/targets/tier-candidates', { address, type })
    const items = InternalTargetSummary.array().safeParse(answer.data.items)
    if (!items.success) return fail('INTERNAL', 'The indexed targets cannot be read.', 503)
    const filled = await withTiers(items.data)
    if (filled === null) return fail('INTERNAL', 'The trust tier cannot be read.', 503)
    // The order of the internal service is kept, so the page of a filter is the page of the
    // unfiltered list with the rows that do not match taken out.
    const matching = filled.filter(item => item.tier === tier)
    const start = (current - 1) * size
    return ok(
      { items: matching.slice(start, start + size) },
      { finalizedBlock: answer.meta.finalizedBlock, page: { total: matching.length, page: current, limit: size } },
    )
  } catch (error) {
    if (error instanceof InternalServiceError) {
      // The internal service refused or could not answer. There is no list to show, so the answer
      // is an error and never an empty list that looks like a registry without targets.
      return fail('INTERNAL', 'The indexed targets cannot be read.', 503)
    }
    return failUnexpected('The target list could not be read.', error)
  }
}
