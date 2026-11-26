import { Skeleton } from '../../../../components/ui/Skeleton'

export default function DisputeLoading() {
  return (
    <div className="sf-target sf-dispute" aria-busy="true">
      <Skeleton />
      <Skeleton />
      <div className="sf-target__body">
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  )
}
