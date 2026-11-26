import { Skeleton } from '../ui/Skeleton'

/** The shape of the target page while the chain is still being read. */
export function TargetSkeleton() {
  return (
    <div className="sf-target sf-target--skeleton" aria-busy="true">
      <Skeleton />
      <div className="sf-target__body">
        <Skeleton />
        <Skeleton />
      </div>
      <Skeleton />
    </div>
  )
}
