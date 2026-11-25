import { Bytes32Schema } from '@sealflare/shared/schemas'
import { fail, failUnexpected, ok } from '../../../../server/respond'
import { internalGet, InternalServiceError, InternalTargetDetail } from '../../../../server/internal'
import { withTier } from '../../../../server/tier'

/**
 * One target, with its signal, its scan and its sandbox result.
 *
 * The tier comes from Core and never from the indexed rows, so the answer says what the
 * registry thinks of the target right now.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const parsed = Bytes32Schema.safeParse(id)
  if (!parsed.success) return fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.', 400)
  try {
    const answer = await internalGet<unknown>(`/targets/${parsed.data}`)
    const item = InternalTargetDetail.safeParse(answer.data)
    if (!item.success) return fail('INTERNAL', 'The indexed target cannot be read.', 503)
    const filled = await withTier(item.data)
    if (filled === null) return fail('INTERNAL', 'The trust tier cannot be read.', 503)
    return ok(filled, { finalizedBlock: answer.meta.finalizedBlock })
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'NOT_FOUND') return fail('NOT_FOUND', 'There is no such target.', 404)
      return fail('INTERNAL', 'The indexed target cannot be read.', 503)
    }
    return failUnexpected('The target could not be read.', error)
  }
}
