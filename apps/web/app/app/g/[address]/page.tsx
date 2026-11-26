import { GuardianProfile } from '../../../../components/guardians/GuardianProfile'

// The profile reads the indexed rows on every request, so it is never a static page.
export const dynamic = 'force-dynamic'

export default async function GuardianPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  return <GuardianProfile address={address} />
}
