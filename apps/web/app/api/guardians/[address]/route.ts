import { AddressSchema, GuardianDetail } from '@sealflare/shared/schemas'
import { fail } from '../../../../server/respond'
import { readOne } from '../../../../server/read'

/**
 * One guardian, with the history of what it did.
 *
 * A guardian that never attested is not a row yet, so the answer is the empty one instead of a
 * guardian that was invented.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ address: string }> },
): Promise<Response> {
  const { address } = await context.params
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) return fail('BAD_REQUEST', 'The address of the guardian is not valid.', 400)
  return readOne({
    path: `/guardians/${parsed.data}`,
    data: GuardianDetail,
    message: 'The indexed guardian cannot be read.',
    notFound: 'There is no such guardian.',
  })
}
