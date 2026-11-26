import { GuardianSummary } from '@sealflare/shared/schemas'
import { fail } from '../../../server/respond'
import { readList, readPage } from '../../../server/read'

/**
 * The guardians the Core knows, the ones with the most votes first.
 *
 * A guardian with a penalty that was never charged is marked, so a reader sees that its score
 * still counts a penalty that is waiting.
 */
export async function GET(request: Request): Promise<Response> {
  const page = readPage(new URL(request.url))
  if (!page.ok) return fail('BAD_REQUEST', 'The query of the guardian list is not valid.', 400)
  return readList({
    path: '/guardians',
    query: { page: page.value.page, limit: page.value.limit },
    item: GuardianSummary,
    message: 'The indexed guardians cannot be read.',
    page: page.value,
  })
}
