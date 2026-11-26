import { z } from 'zod'
import { BountyDetail } from '@sealflare/shared/schemas'
import { fail } from '../../../../server/respond'
import { readOne } from '../../../../server/read'

/**
 * The id of a bounty, as the indexer writes it.
 *
 * The id is put into the path of the internal service, so it may only hold the characters of a
 * plain id. A path that holds anything else never reaches the internal service.
 */
const BountyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/**
 * One bounty, with the slots it filled.
 *
 * The verdict of every slot is in the answer, because a bounty is only settled when its slots
 * are filled.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const parsed = BountyId.safeParse(id)
  if (!parsed.success) return fail('BAD_REQUEST', 'The id of the bounty is not valid.', 400)
  return readOne({
    path: `/bounties/${parsed.data}`,
    data: BountyDetail,
    message: 'The indexed bounty cannot be read.',
    notFound: 'There is no such bounty.',
  })
}
