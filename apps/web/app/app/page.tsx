import { ScanPanel } from '../../components/target/ScanPanel'
import { copy } from '../../lib/copy'

// The landing page sends the pasted input as `?q=`, so the page reads the query on every request.
export const dynamic = 'force-dynamic'

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  return (
    <>
      <h1>{copy.scan.title}</h1>
      <p className="sf-lead">{copy.scan.intro}</p>
      <ScanPanel initialQuery={params.q ?? ''} />
    </>
  )
}
