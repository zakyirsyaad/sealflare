import 'server-only'
import { BountySummary } from '@sealflare/shared/schemas'
import { internalGet } from './internal'

/** The size of a page of bounties. */
const PAGE_SIZE = 20

export type BountyListData = {
  items: BountySummary[]
  /** How many bounties the filters match, so the pager knows how many pages there are. */
  total: number
  page: number
  limit: number
  failed: boolean
}

/**
 * The bounties the indexer read.
 *
 * The internal service is the only door to the database. A failure of the service is an error,
 * never an empty list, so a reader never sees a registry that looks empty because the service
 * was down.
 *
 * The open bounties are filtered by the query of the service, so the rows of a page are the
 * bounties that can still be filled and not the open ones of a page that was read first. The
 * total comes with them, so the pager never hides a page that exists.
 */
export async function loadBounties(options: { page?: number; open?: boolean } = {}): Promise<BountyListData> {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  try {
    const answer = await internalGet<{ items: unknown[] }>('/bounties', {
      page,
      limit: PAGE_SIZE,
      ...(options.open === undefined ? {} : { open: options.open ? 'true' : 'false' }),
    })
    const parsed = BountySummary.array().safeParse(answer.data.items)
    if (!parsed.success) throw new Error('The indexed bounties cannot be read.')
    return {
      items: parsed.data,
      total: answer.meta.page?.total ?? parsed.data.length,
      page,
      limit: PAGE_SIZE,
      failed: false,
    }
  } catch {
    return { items: [], total: 0, page, limit: PAGE_SIZE, failed: true }
  }
}
