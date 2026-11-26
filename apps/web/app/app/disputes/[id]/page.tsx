import { DisputeScreen } from '../../../../components/dispute/DisputeScreen'
import { modulesLive } from '../../../../lib/chain/config'
import { loadDispute } from '../../../../server/disputes'

// The phase of a dispute moves with the chain, so the page is never cached as a static page.
export const dynamic = 'force-dynamic'

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = modulesLive
    ? await loadDispute(id)
    : { detail: null, publisherRole: 'NONE' as const, publisher: null, failed: false }
  return <DisputeScreen {...data} />
}
