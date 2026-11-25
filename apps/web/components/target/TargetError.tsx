'use client'
import { ErrorState } from '../ui/ErrorState'
import { copy } from '../../lib/copy'

/**
 * The chain could not be read. The on-chain data of the visitor is untouched, so the page only
 * says that it could not be verified and offers a retry.
 */
export function TargetError() {
  return (
    <div className="sf-target sf-target--error">
      <ErrorState what={copy.errors.unknown} onChainSafe onRetry={() => window.location.reload()} />
    </div>
  )
}
