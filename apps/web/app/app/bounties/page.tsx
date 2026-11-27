import { BountyList } from '../../../components/bounty/BountyList'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { copy } from '../../../lib/copy'
import { publicEnv } from '../../../lib/env.public'
import { loadBounties } from '../../../server/bounties'

// The page reads the indexed bounties on every request, so it is never cached as a static page.
export const dynamic = 'force-dynamic'

/** The page of the query, or the first one when the query names none. */
function readPage(value: string | undefined): number {
  if (value === undefined) return 1
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return 1
  return parsed
}

export default async function BountiesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams
  const live = publicEnv.NEXT_PUBLIC_MODULES_LIVE
  // While the vault is not live the page shows the empty state of the design, and the indexer is
  // not read at all: a service that is down must not change what the page says.
  const data = live
    ? await loadBounties({ page: readPage(params.page), open: true })
    : { items: [], total: 0, page: 1, limit: 20, failed: false }
  return (
    <section className="sf-stack">
      <h1 className="sf-identity__label">{copy.bounty.title}</h1>
      <p className="sf-lead">{copy.bounty.intro}</p>
      {!live && <EmptyState title={copy.common.modulesNotLive} />}
      {live && data.failed && (
        <ErrorState what={copy.bounty.readFailed} onChainSafe retryHref="/app/bounties" />
      )}
      {live && !data.failed && (
        <BountyList items={data.items} total={data.total} page={data.page} limit={data.limit} />
      )}
    </section>
  )
}
