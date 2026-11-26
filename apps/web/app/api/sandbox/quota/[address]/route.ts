import { AddressSchema } from '@sealflare/shared/schemas'
import { fail, failUnexpected, ok } from '../../../../../server/respond'
import { internalRead, InternalServiceError } from '../../../../../server/internal'

/**
 * The runs an address has left today.
 *
 * The quota is counted in the internal service, in the same table the queue takes from, so the
 * number on the screen is the number of runs that can still be started.
 */
export async function GET(_request: Request, context: { params: Promise<{ address: string }> }): Promise<Response> {
  const { address } = await context.params
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) return fail('BAD_REQUEST', 'The address is not an address.', 400)
  try {
    const answer = await internalRead<unknown>(`/sandbox/quota/${parsed.data}`)
    return ok(answer.data)
  } catch (error) {
    if (error instanceof InternalServiceError) return fail(error.code, error.message, 500)
    return failUnexpected('The sandbox quota could not be read.', error)
  }
}
