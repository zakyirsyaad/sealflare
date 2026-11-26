import Link from 'next/link'
import { Button } from './Button'
import { copy } from '../../lib/copy'

type Props = { what: string; onChainSafe: boolean } & ({ onRetry: () => void; retryHref?: never } | { onRetry?: never; retryHref: string })

/** What failed, whether the on-chain data is safe, and a way to try again. */
export function ErrorState({ what, onChainSafe, onRetry, retryHref }: Props) {
  return <section className="sf-error" role="alert"><h2>{what}</h2><p>{onChainSafe ? copy.common.onChainSafe : copy.common.onChainUnknown}</p>
    {retryHref !== undefined
      ? <Link className="sf-btn sf-btn--secondary" href={retryHref}>{copy.common.retry}</Link>
      : <Button onClick={onRetry}>{copy.common.retry}</Button>}
  </section>
}
