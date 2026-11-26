import { AddressSchema, BountySummary, Bytes32Schema } from '@sealflare/shared/schemas'
import { fail } from '../../../server/respond'
import { readList, readPage } from '../../../server/read'

/**
 * The bounties the Vault brought, the open ones first.
 *
 * A bounty is keyed by the target it was made for, so the list can be narrowed to one target or
 * to the bounties of one account.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const page = readPage(url)
  if (!page.ok) return fail('BAD_REQUEST', 'The query of the bounty list is not valid.', 400)
  const targetId = url.searchParams.get('targetId')
  if (targetId !== null && !Bytes32Schema.safeParse(targetId).success) {
    return fail('BAD_REQUEST', 'The query of the bounty list is not valid.', 400)
  }
  const requester = url.searchParams.get('requester')
  if (requester !== null && !AddressSchema.safeParse(requester).success) {
    return fail('BAD_REQUEST', 'The query of the bounty list is not valid.', 400)
  }
  return readList({
    path: '/bounties',
    query: {
      page: page.value.page,
      limit: page.value.limit,
      targetId: targetId ?? undefined,
      requester: requester ?? undefined,
    },
    item: BountySummary,
    message: 'The indexed bounties cannot be read.',
    page: page.value,
  })
}
