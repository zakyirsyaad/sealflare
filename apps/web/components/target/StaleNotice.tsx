import { Banner } from '../ui/Banner'
import { copy } from '../../lib/copy'

export type StaleNoticeProps = { blocksBehind: number | null }

/** The scan is older than the chain. The visitor is told how far behind it is. */
export function StaleNotice({ blocksBehind }: StaleNoticeProps) {
  if (blocksBehind === null || blocksBehind <= 0) return null
  return (
    <Banner tone="info">
      <div className="sf-banner__text">{copy.target.lagging.replace('{blocks}', String(blocksBehind))}</div>
    </Banner>
  )
}
