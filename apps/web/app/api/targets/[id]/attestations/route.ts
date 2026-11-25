import { z } from 'zod'
import { AttestationRow, Bytes32Schema } from '@sealflare/shared/schemas'
import { fail, failUnexpected, ok } from '../../../../../server/respond'
import { internalGet, InternalServiceError } from '../../../../../server/internal'

/** The default size of a page. */
const DEFAULT_LIMIT = 20

/** The query of the attestation list. Only the page and the limit mean something here. */
const PageQuery = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

/** The votes of a target, in the order the contract numbered them. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const targetId = Bytes32Schema.safeParse(id)
  if (!targetId.success) return fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.', 400)
  const params = new URL(request.url).searchParams
  const parsed = PageQuery.safeParse({
    page: readNumber(params.get('page')),
    limit: readNumber(params.get('limit')),
  })
  if (!parsed.success) return fail('BAD_REQUEST', 'The query of the attestation list is not valid.', 400)
  const current = parsed.data.page ?? 1
  const size = parsed.data.limit ?? DEFAULT_LIMIT
  try {
    const answer = await internalGet<{ items: unknown[] }>(`/targets/${targetId.data}/attestations`, { page: current, limit: size })
    // The votes are checked with the frozen read model, so a row that does not fit it is
    // refused instead of answered.
    const items = AttestationRow.array().safeParse(answer.data.items)
    if (!items.success) return fail('INTERNAL', 'The indexed votes cannot be read.', 503)
    const total = answer.meta.page?.total ?? items.data.length
    return ok({ items: items.data }, { finalizedBlock: answer.meta.finalizedBlock, page: { total, page: current, limit: size } })
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'NOT_FOUND') return fail('NOT_FOUND', 'There is no such target.', 404)
      return fail('INTERNAL', 'The indexed votes cannot be read.', 503)
    }
    return failUnexpected('The votes could not be read.', error)
  }
}

/** A number of the query, or nothing when the query does not hold one. */
function readNumber(text: string | null): number | undefined {
  if (text === null || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}
