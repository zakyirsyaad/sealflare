import { copy } from '../../lib/copy'

/**
 * The shape of the content that is loading.
 *
 * A list shows rows, so its skeleton shows rows too. The shape of the skeleton is the shape of
 * the answer, so the page does not jump when the rows arrive.
 */
export function Skeleton({ label = copy.common.loading, rows = 0 }: { label?: string; rows?: number }) {
  if (rows <= 0) {
    return (
      <div className="sf-skeleton" role="status" aria-label={label}>
        <span className="sf-sr-only">{label}</span>
      </div>
    )
  }
  return (
    <div className="sf-skeleton-list" role="status" aria-label={label}>
      <span className="sf-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="sf-skeleton-row" />
      ))}
    </div>
  )
}
