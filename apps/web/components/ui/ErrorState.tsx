import { Button } from './Button'
import { copy } from '../../lib/copy'
export function ErrorState({ what, onChainSafe, onRetry, retryHref }: { what: string; onChainSafe: boolean; onRetry?: () => void; retryHref?: string }) {
  return <section className="sf-error" role="alert"><h2>{what}</h2><p>{onChainSafe ? copy.common.onChainSafe : copy.common.onChainUnknown}</p>
    {retryHref !== undefined
      ? <a className="sf-btn sf-btn--secondary" href={retryHref}>{copy.common.retry}</a>
      : onRetry !== undefined && <Button onClick={onRetry}>{copy.common.retry}</Button>}
  </section>
}
