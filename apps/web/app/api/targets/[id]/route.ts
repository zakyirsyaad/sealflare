import { Bytes32Schema } from '@sealflare/shared/schemas'
import { fail, ok } from '../../../../server/respond'
import { internalGet, InternalServiceError, InternalTargetDetail } from '../../../../server/internal'
import { withTier } from '../../../../server/tier'
import { deadlineFromNow, withDeadline } from '../../../../server/deadline'

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
  const deadlineAt = deadlineFromNow()
  try {
    return await withDeadline(answerTarget(parsed.data, deadlineAt), deadlineAt)
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'NOT_FOUND') return fail('NOT_FOUND', 'There is no such target.', 404)
      return fail('INTERNAL', 'The indexed target cannot be read.', 503)
    }
    console.error('The target could not be read.', error instanceof Error ? error.name : 'unknown')
    return fail('INTERNAL', 'The target could not be read.', 503)
  }
}

/** The answer of one target, with the tier of Core filled in. */
async function answerTarget(targetId: string, deadlineAt: number): Promise<Response> {
  const answer = await internalGet<unknown>(`/targets/${targetId}`)
  const item = InternalTargetDetail.safeParse(answer.data)
  if (!item.success) return fail('INTERNAL', 'The indexed target cannot be read.', 503)
  const filled = await withTier(item.data, deadlineAt)
  if (filled === null) return fail('INTERNAL', 'The trust tier cannot be read.', 503)
  return ok(filled, { finalizedBlock: answer.meta.finalizedBlock })
}
