import { ExploreList } from '../../../components/explore/ExploreList'
import { readKind, readPage, readVerdict } from '../../../lib/listQuery'

// The filters of the list live in the query, so the page reads them on every request.
export const dynamic = 'force-dynamic'

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; verdict?: string; page?: string }>
}) {
  const params = await searchParams
  return (
    <ExploreList kind={readKind(params.kind)} verdict={readVerdict(params.verdict)} page={readPage(params.page)} />
  )
}
