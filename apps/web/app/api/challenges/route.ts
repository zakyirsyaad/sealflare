import { Bytes32Schema, ChallengeSummary } from '@sealflare/shared/schemas'
import { fail } from '../../../server/respond'
import { readList, readPage } from '../../../server/read'

/**
 * The disputes the Court brought, the newest first.
 *
 * The phase of a dispute is the phase it is in right now, and the direction of a vote is never
 * part of this answer.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const page = readPage(url)
  if (!page.ok) return fail('BAD_REQUEST', 'The query of the dispute list is not valid.', 400)
  const targetId = url.searchParams.get('targetId')
  if (targetId !== null && !Bytes32Schema.safeParse(targetId).success) {
    return fail('BAD_REQUEST', 'The query of the dispute list is not valid.', 400)
  }
  return readList({
    path: '/challenges',
    query: { page: page.value.page, limit: page.value.limit, targetId: targetId ?? undefined },
    item: ChallengeSummary,
    message: 'The indexed disputes cannot be read.',
    page: page.value,
  })
}
