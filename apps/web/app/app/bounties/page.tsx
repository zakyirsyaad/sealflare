import type { BountySummary } from '@sealflare/shared/schemas'
import { BountyList } from '../../../components/bounty/BountyList'
import { ErrorState } from '../../../components/ui/ErrorState'
import { copy } from '../../../lib/copy'
import { publicEnv } from '../../../lib/env.public'
import { loadBounties } from '../../../server/bounties'

// The page reads the indexed bounties on every request, so it is never cached as a static page.
export const dynamic = 'force-dynamic'

export default async function BountiesPage() {
  const live = publicEnv.NEXT_PUBLIC_MODULES_LIVE
  // While the vault is not live the page shows the empty state of the design, and the indexer is
  // not read at all: a service that is down must not change what the page says.
  if (!live) return <BountyList items={[]} live={false} />
  let items: BountySummary[] | null = null
  try {
    items = await loadBounties()
  } catch {
    items = null
  }
  if (items === null) {
    return <ErrorState what={copy.bounty.readFailed} onChainSafe retryHref="/app/bounties" />
  }
  return (
    <section className="sf-stack">
      <h1 className="sf-identity__label">{copy.bounty.title}</h1>
      <p className="sf-lead">{copy.bounty.intro}</p>
      <BountyList items={items} live />
    </section>
  )
}
