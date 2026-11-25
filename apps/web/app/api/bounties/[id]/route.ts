import { BountyDetail } from '@sealflare/shared/schemas'
import { fail } from '../../../../server/respond'
import { readOne } from '../../../../server/read'

/**
 * One bounty, with the slots it filled.
 *
 * The verdict of every slot is in the answer, because a bounty is only settled when its slots
 * are filled.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  if (id.trim() === '') return fail('BAD_REQUEST', 'The id of the bounty is not valid.', 400)
  return readOne({
    path: `/bounties/${id}`,
    data: BountyDetail,
    message: 'The indexed bounty cannot be read.',
    notFound: 'There is no such bounty.',
  })
}
