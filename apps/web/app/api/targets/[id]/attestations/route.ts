import { AttestationRow, Bytes32Schema, ListQuery } from '@sealflare/shared/schemas'
import { fail, ok } from '../../../../../server/respond'
import { internalGet, InternalServiceError } from '../../../../../server/internal'
import { withDeadline } from '../../../../../server/deadline'

/** The default size of a page. */
const DEFAULT_LIMIT = 20

/** The votes of a target, in the order the contract numbered them. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const targetId = Bytes32Schema.safeParse(id)
  if (!targetId.success) return fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.', 400)
  const params = new URL(request.url).searchParams
  // The frozen `ListQuery` owns the size of a page, so the limit here is the limit there.
  const parsed = ListQuery.safeParse({
    page: readNumber(params.get('page')),
    limit: readNumber(params.get('limit')),
  })
  if (!parsed.success) return fail('BAD_REQUEST', 'The query of the attestation list is not valid.', 400)
  const current = parsed.data.page ?? 1
  const size = parsed.data.limit ?? DEFAULT_LIMIT
  try {
    return await withDeadline(answerAttestations(targetId.data, current, size))
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'NOT_FOUND') return fail('NOT_FOUND', 'There is no such target.', 404)
      return fail('INTERNAL', 'The indexed votes cannot be read.', 503)
    }
    console.error('The votes could not be read.', error instanceof Error ? error.name : 'unknown')
    return fail('INTERNAL', 'The votes could not be read.', 503)
  }
}

/** The votes of one target, with the page of the internal service. */
async function answerAttestations(targetId: string, page: number, limit: number): Promise<Response> {
  const answer = await internalGet<{ items: unknown[] }>(`/targets/${targetId}/attestations`, { page, limit })
  // The votes are checked with the frozen read model, so a row that does not fit it is
  // refused instead of answered.
  const items = AttestationRow.array().safeParse(answer.data.items)
  if (!items.success) return fail('INTERNAL', 'The indexed votes cannot be read.', 503)
  const total = answer.meta.page?.total
  if (total === undefined) return fail('INTERNAL', 'The indexed votes cannot be read.', 503)
  return ok({ items: items.data }, { finalizedBlock: answer.meta.finalizedBlock, page: { total, page, limit } })
}

/** A number of the query, or nothing when the query does not hold one. */
function readNumber(text: string | null): number | undefined {
  if (text === null || text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}
