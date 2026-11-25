import { Activity, AddressSchema } from '@sealflare/shared/schemas'
import { fail } from '../../../../server/respond'
import { readOne } from '../../../../server/read'

/**
 * The activity of one account: what it has to do, what it may withdraw and what it did.
 *
 * The deadlines of the actions are read at one moment, so the answer of that moment is the
 * same for every reader of it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ address: string }> },
): Promise<Response> {
  const { address } = await context.params
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) return fail('BAD_REQUEST', 'The address of the account is not valid.', 400)
  return readOne({
    path: `/activity/${parsed.data}`,
    data: Activity,
    message: 'The indexed activity cannot be read.',
    notFound: 'There is no such account.',
  })
}
