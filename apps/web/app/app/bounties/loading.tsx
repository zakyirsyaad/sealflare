import { Skeleton } from '../../../components/ui/Skeleton'

/** The shape of the bounties page while the indexed bounties are still being read. */
export default function BountiesLoading() {
  return (
    <div className="sf-stack" aria-busy="true">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  )
}
