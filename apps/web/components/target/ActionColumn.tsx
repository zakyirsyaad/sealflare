'use client'
import { CONSTANTS, type TrustTier } from '@sealflare/shared/rules'
import { useUserState } from '../../lib/chain/userState'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type ActionColumnProps = {
  tier: TrustTier
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** Scans the skill's repository as it is now. Null when the source is not known. */
  currentVersionHref: string | null
}

/** Why the attest button is closed, in one sentence. */
function blockedReason(kind: string, attestationsLeft: number | null, codeChanged: boolean): string | null {
  if (codeChanged) return copy.errors.CodeChangedSincePin
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
export function ActionColumn({ tier, targetType, currentVersionHref }: ActionColumnProps) {
  const user = useUserState()
  const left = user.kind === 'holder' ? user.attestationsLeft : null
  // ux.md 6.4: a contract whose code changed closes Attest, a skill that changed asks for a new scan.
  const changed = tier === 'STALE_CODEHASH_DRIFT'
  const skillChanged = changed && targetType === 'AI_SKILL_BUNDLE'
  const reason = skillChanged ? null : blockedReason(user.kind, left, changed)
  const busy = user.isLoading || user.isError
  const quota =
    left === null
      ? copy.target.quotaDefault.replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
      : copy.target.quotaLeft.replace('{left}', String(left)).replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
  return (
    <aside className="sf-actions" aria-label={copy.attest.action}>
      {skillChanged ? (
        currentVersionHref === null ? (
          <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled>
            {copy.target.currentVersion}
          </Button>
        ) : (
          <a className="sf-btn sf-btn--primary sf-btn--lg sf-btn--block" href={currentVersionHref}>
            {copy.target.currentVersion}
          </a>
        )
      ) : (
        <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled={reason !== null || busy}>
          {copy.attest.action}
        </Button>
      )}
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
