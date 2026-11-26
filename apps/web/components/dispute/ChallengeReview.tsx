'use client'
import { CONSTANTS, XP, type FlagName } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { flagLabel, formatBnb, targetLabel } from '../../lib/format'
import { AttestButton } from '../attest/AttestButton'
import { isWorking, type AttestState } from '../attest/useAttest'

export type ChallengeReviewProps = {
  /** The name of the target, as the page shows it. */
  label: string
  flags: readonly FlagName[]
  /** The share of the stake forfeited if the dispute expires, in basis points. Null while unknown. */
  forfeitBps: number | null
  forfeitFailed: boolean
  /** There is no Court to challenge, so nothing can be signed. */
  noCourt: boolean
  state: AttestState
  error: string | null
  txHash: string | null
  onSubmit: () => void
  onBack: () => void
  onRetry: () => void
}

const BPS = 10_000

function Row({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="sf-rows__row">
      <span className="sf-rows__name">{name}</span>
      <span className="sf-rows__value">{value}</span>
    </div>
  )
}

/** What goes on-chain: the target, the flags, the evidence and the stake. */
function OnChain({ label, flags }: Pick<ChallengeReviewProps, 'label' | 'flags'>) {
  return (
    <section className="sf-stack">
      <span className="sf-mono">{copy.attest.onChain}</span>
      <div className="sf-rows">
        <Row name={copy.attest.rowTarget} value={<span className="sf-mono">{targetLabel(label)}</span>} />
        <Row name={copy.dispute.rowFlags} value={<span className="sf-mono">{flags.map(flagLabel).join(', ')}</span>} />
        <Row name={copy.attest.rowEvidence} value={copy.attest.rowEvidenceValue} />
        <Row
          name={copy.dispute.rowStake}
          value={copy.dispute.stakeValue.replace('{amount}', formatBnb(CONSTANTS.CHALLENGE_STAKE))}
        />
      </div>
    </section>
  )
}

/** The four ways a dispute ends, with the money that returns to the challenger in each. */
function Endings({ forfeitBps }: { forfeitBps: number | null }) {
  const stake = formatBnb(CONSTANTS.CHALLENGE_STAKE)
  const back = forfeitBps === null ? null : formatBnb((CONSTANTS.CHALLENGE_STAKE * BigInt(BPS - forfeitBps)) / BigInt(BPS))
  return (
    <section className="sf-stack">
      <span className="sf-mono">{copy.dispute.endingsTitle}</span>
      <ul className="sf-endings">
        <li>{copy.dispute.endingUpheld.replace('{stake}', stake)}</li>
        <li>{copy.dispute.endingRejected.replace('{xp}', String(Math.abs(XP.CHALLENGER_LOST)))}</li>
        <li>{copy.dispute.endingTie.replace('{stake}', stake)}</li>
        {back !== null && <li>{copy.dispute.endingExpired.replace('{back}', back).replace('{stake}', stake)}</li>}
      </ul>
    </section>
  )
}

/** What may be lost and what follows an expiry: the forfeited share for this target and the cooldown. */
function Notes({ forfeitBps, forfeitFailed, noCourt }: Pick<ChallengeReviewProps, 'forfeitBps' | 'forfeitFailed' | 'noCourt'>) {
  const days = String(CONSTANTS.CHALLENGE_COOLDOWN / 86400)
  return (
    <section className="sf-stack">
      {forfeitBps !== null && (
        <p className="sf-lead">
          {copy.dispute.expireNote
            .replace('{min}', String(CONSTANTS.MIN_REVEALS))
            .replace('{percent}', String(forfeitBps / 100))}
        </p>
      )}
      {forfeitBps === null && (
        <p className="sf-lead" role={forfeitFailed || noCourt ? 'alert' : 'status'}>
          {/* Without a Court there is nothing to sign to, and that is the reason the share is unknown. */}
          {noCourt ? copy.dispute.noCourt : forfeitFailed ? copy.dispute.forfeitUnknown : copy.dispute.forfeitPending}
        </p>
      )}
      <p className="sf-lead">{copy.dispute.cooldownNote.replace('{days}', days)}</p>
    </section>
  )
}

/**
 * The third step: what the signature writes, what it costs, and the four endings. The summary is
 * plain language, so the challenger reads it before the wallet opens.
 */
export function ChallengeReview(props: ChallengeReviewProps) {
  return (
    <>
      <OnChain label={props.label} flags={props.flags} />
      <Endings forfeitBps={props.forfeitBps} />
      <Notes forfeitBps={props.forfeitBps} forfeitFailed={props.forfeitFailed} noCourt={props.noCourt} />
      <footer className="sf-panel__footer">
        <p className="sf-lead">{copy.attest.twoApprovals}</p>
        <div className="sf-rows">
          <Row name={copy.attest.approveEvidence} value={copy.attest.noGas} />
          <Row name={copy.attest.approveTransaction} value={copy.attest.gas} />
        </div>
        <AttestButton
          state={props.state}
          error={props.error}
          txHash={props.txHash}
          label={copy.dispute.submit}
          disabled={props.forfeitBps === null}
          onSubmit={props.onSubmit}
          onRetry={props.onRetry}
        />
        <Button variant="secondary" disabled={isWorking(props.state)} onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
