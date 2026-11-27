import { Skeleton } from '../../../components/ui/Skeleton'

/**
 * The shape of the bounties page while the indexed bounties are still being read.
 *
 * The page ends in a table, so the skeleton has the shape of a table too.
 */
export default function BountiesLoading() {
  return (
    <section className="sf-stack" aria-busy="true">
      <Skeleton />
      <div className="sf-frame sf-scroll">
        <Skeleton />
      </div>
    </section>
  )
}
