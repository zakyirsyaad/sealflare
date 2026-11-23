import { copy } from '../../lib/copy'
export function Skeleton({ label = copy.common.loading }: { label?: string }) {
  return <div className="sf-skeleton" role="status" aria-label={label}><span className="sf-sr-only">{label}</span></div>
}
