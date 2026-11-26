import 'server-only'
import { BountySummary } from '@sealflare/shared/schemas'
import { internalGet } from './internal'

/**
 * The bounties the indexer read.
 *
 * The internal service is the only door to the database. A failure of the service is an error,
 * never an empty list, so a reader never sees a registry that looks empty because the service
 * was down.
 */
export async function loadBounties(): Promise<BountySummary[]> {
  const answer = await internalGet<{ items: unknown[] }>('/bounties')
  const parsed = BountySummary.array().safeParse(answer.data.items)
  if (!parsed.success) throw new Error('The indexed bounties cannot be read.')
  return parsed.data
}
