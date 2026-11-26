import { DisputesScreen } from '../../../components/dispute/DisputesScreen'
import { modulesLive } from '../../../lib/chain/config'
import { loadDisputes } from '../../../server/disputes'

// The disputes change with every block, so the page is never cached as a static page.
export const dynamic = 'force-dynamic'

export default async function DisputesPage() {
  // Before the Court is live there is nothing to read, so the service is not asked.
  const data = modulesLive ? await loadDisputes() : { items: [], total: 0, failed: false }
  return <DisputesScreen items={data.items} failed={data.failed} />
}
