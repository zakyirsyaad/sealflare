'use client'
import { CONSTANTS, type TrustTier } from '@sealflare/shared/rules'
import { useUserState } from '../../lib/chain/userState'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type ActionColumnProps = {
  tier: TrustTier
}

/** Why the attest button is closed, in one sentence. */
function blockedReason(kind: string, attestationsLeft: number | null): string | null {
  if (kind === 'no-wallet') return copy.target.attestHint
  if (kind === 'wrong-network') return copy.wallet.switchNetwork
  if (kind === 'no-agent-id') return copy.wallet.agentRequired
  if (kind === 'holder' && attestationsLeft === 0) return copy.wallet.quotaExhausted
  return null
}

/**
 * The actions of the target page. The attest button follows the state of the wallet: it is
 * closed with a reason when the user cannot attest yet.
 */
export function ActionColumn({ tier }: ActionColumnProps) {
  const user = useUserState()
  const left = user.kind === 'holder' ? user.attestationsLeft : null
  const reason = blockedReason(user.kind, left)
  const busy = user.isLoading || user.isError
  const quota =
    left === null
      ? copy.target.quotaDefault.replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
      : copy.target.quotaLeft.replace('{left}', String(left)).replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
  return (
    <aside className="sf-actions" aria-label={copy.attest.action}>
      <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled={reason !== null || busy}>
        {copy.attest.action}
      </Button>
      <Button variant="secondary" className="sf-btn--block" disabled>
        {copy.target.challenge}
      </Button>
      <Button variant="secondary" className="sf-btn--block" disabled>
        {copy.target.fundBounty}
      </Button>
      <p className="sf-actions__note">{copy.common.modulesNotLive}</p>
      <div className="sf-actions__meta">
        <p className="sf-mono sf-actions__quota">{quota}</p>
        {reason !== null && <p className="sf-actions__reason">{reason}</p>}
        {user.kind === 'holder' && reason === null && <p className="sf-actions__note">{copy.attest.claimable}</p>}
        {tier === 'UNRATED' && (
          <div className="sf-actions__invite">
            <p className="sf-actions__invite-title">{copy.attest.first}</p>
            <p className="sf-actions__note">{copy.target.firstXp}</p>
          </div>
        )}
        <p className="sf-actions__note">{copy.target.safeRisk}</p>
      </div>
    </aside>
  )
}
