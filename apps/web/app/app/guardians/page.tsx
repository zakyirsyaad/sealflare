import { GuardiansList } from '../../../components/guardians/GuardiansList'
import { readPage } from '../../../lib/listQuery'

// The page of the list lives in the query, so the page reads it on every request.
export const dynamic = 'force-dynamic'

export default async function GuardiansPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const params = await searchParams
  return <GuardiansList page={readPage(params.page)} />
}
