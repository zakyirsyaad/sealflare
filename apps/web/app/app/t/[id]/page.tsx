import { TargetScreen } from '../../../../components/target/TargetScreen'
import { loadTarget } from '../../../../server/target'

// The page reads the chain on every request, so it is never cached as a static page.
export const dynamic = 'force-dynamic'

export default async function TargetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ src?: string }>
}) {
  const { id } = await params
  const { src } = await searchParams
  const data = await loadTarget(id, src ?? null)
  return <TargetScreen {...data} />
}
