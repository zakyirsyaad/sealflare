import { Button } from './Button'
import { copy } from '../../lib/copy'
export function ErrorState({ what, onChainSafe, onRetry }: { what: string; onChainSafe: boolean; onRetry: () => void }) {
  return <section className="sf-error" role="alert"><h2>{what}</h2><p>{onChainSafe ? copy.common.onChainSafe : copy.common.onChainUnknown}</p><Button onClick={onRetry}>{copy.common.retry}</Button></section>
}
