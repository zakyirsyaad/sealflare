'use client'
import { useState } from 'react'
import { CONSTANTS, type TrustTier } from '@sealflare/shared/rules'
import type { AttestationRow, ScanReport } from '@sealflare/shared/schemas'
import { useUserState } from '../../lib/chain/userState'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { verdictLabel } from '../../lib/format'
import { AttestPanel } from '../attest/AttestPanel'
import { attestAvailability } from '../attest/availability'

export type ActionColumnProps = {
  tier: TrustTier
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** Scans the skill's repository as it is now. Null when the source is not known. */
  currentVersionHref: string | null
  targetId: string
  /** The name of the target, as the page shows it. */
  label: string
  scan: ScanReport | null
  attestations: AttestationRow[]
  /** A challenge is open on this target. */
  underDispute: boolean
}

/** The vote of this user on this target, when there is one. */
function previousVote(
  address: string | undefined,
  attestations: AttestationRow[],
): { verdict: AttestationRow['verdict']; txHash: string } | null {
  if (address === undefined) return null
  const row = attestations.find(item => item.guardian.toLowerCase() === address.toLowerCase())
  return row === undefined ? null : { verdict: row.verdict, txHash: row.txHash }
}

/**
 * The actions of the target page. The attest button follows the state of the wallet: it is
 * closed with a reason when the user cannot attest yet, and it opens the attest panel when the
 * vote can be written.
 */
export function ActionColumn(props: ActionColumnProps) {
  const user = useUserState()
  const [open, setOpen] = useState(false)
  const left = user.kind === 'holder' ? user.attestationsLeft : null
  const previous = previousVote('address' in user ? user.address : undefined, props.attestations)
  const availability = attestAvailability({
    kind: user.kind,
    attestationsLeft: left,
    tier: props.tier,
    targetType: props.targetType,
    previous,
  })
  const busy = user.isLoading || user.isError
  const quota =
    left === null
      ? copy.target.quotaDefault.replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
      : copy.target.quotaLeft.replace('{left}', String(left)).replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
  const reason =
    availability.kind === 'code-changed'
      ? copy.errors.CodeChangedSincePin
      : availability.kind === 'no-wallet'
        ? copy.target.attestHint
        : availability.kind === 'quota-exhausted'
          ? copy.wallet.quotaExhausted
          : null
  const attestButton = () => {
    if (availability.kind === 'skill-changed') {
      return props.currentVersionHref === null ? (
        <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled>
          {copy.target.currentVersion}
        </Button>
      ) : (
        <a className="sf-btn sf-btn--primary sf-btn--lg sf-btn--block" href={props.currentVersionHref}>
          {copy.target.currentVersion}
        </a>
      )
    }
    if (availability.kind === 'already-attested') {
      return (
        <a className="sf-btn sf-btn--primary sf-btn--lg sf-btn--block" href={`https://bscscan.com/tx/${availability.txHash}`} target="_blank" rel="noreferrer">
          {copy.attest.alreadyVerdict.replace('{verdict}', verdictLabel(availability.verdict))}
        </a>
      )
    }
    return (
      <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled={reason !== null || busy} onClick={() => setOpen(true)}>
        {copy.attest.action}
      </Button>
    )
  }
  return (
    <aside className="sf-actions" aria-label={copy.attest.action}>
      {attestButton()}
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
        {props.tier === 'UNRATED' && (
          <div className="sf-actions__invite">
            <p className="sf-actions__invite-title">{copy.attest.first}</p>
            <p className="sf-actions__note">{copy.target.firstXp}</p>
          </div>
        )}
        <p className="sf-actions__note">{copy.target.safeRisk}</p>
      </div>
      {open && (
        <AttestPanel
          targetId={props.targetId}
          targetType={props.targetType}
          label={props.label}
          tier={props.tier}
          scan={props.scan}
          attestations={props.attestations}
          underDispute={props.underDispute}
          onClose={() => setOpen(false)}
        />
      )}
    </aside>
  )
}
