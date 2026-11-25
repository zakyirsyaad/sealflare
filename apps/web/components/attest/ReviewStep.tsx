'use client'
import type { Verdict } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { flagLabel, shortAddress } from '../../lib/format'
import { AttestButton } from './AttestButton'
import { flagsOf, type Choice } from './choice'
import type { AttestState } from './useAttest'

export type ReviewStepProps = {
  /** The name of the target, as the page shows it. */
  label: string
  choice: Choice
  /** The attestations the user has left today. */
  attestationsLeft: number | null
  /** The daily limit of attestations. */
  limit: number
  state: AttestState
  error: string | null
  txHash: string | null
  voted: Verdict | null
  /** A challenge is open on this target, so the vote earns no XP. */
  underDispute: boolean
  onSubmit: () => void
  onBack: () => void
  onRetry: () => void
}

const reward: Record<Verdict, string> = {
  SAFE: copy.attest.rewardSafe,
  CAUTION: copy.attest.rewardCaution,
  DANGER: copy.attest.rewardDanger,
}

const risk: Record<Verdict, string> = {
  SAFE: copy.attest.riskSafe,
  CAUTION: copy.attest.riskNone,
  DANGER: copy.attest.riskNone,
}

const verdictName: Record<Verdict, string> = {
  SAFE: copy.attest.safe,
  CAUTION: copy.attest.caution,
  DANGER: copy.attest.danger,
}

function Row({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="sf-rows__row">
      <span className="sf-rows__name">{name}</span>
      <span className="sf-rows__value">{value}</span>
    </div>
  )
}

/**
 * The second step: what goes on-chain, what the vote is worth, and what may not be changed.
 *
 * The summary is plain language about the write, the reward and the risk, so the Guardian reads it
 * before the wallet opens.
 */
export function ReviewStep(props: ReviewStepProps) {
  const { choice } = props
  const verdict = choice.verdict
  if (verdict === null) return null
  const flags = flagsOf(choice)
  const quota =
    props.attestationsLeft === null
      ? copy.target.quotaDefault.replace('{limit}', String(props.limit))
      : copy.target.quotaLeft.replace('{left}', String(props.attestationsLeft)).replace('{limit}', String(props.limit))
  return (
    <>
      <section className="sf-stack">
        <span className="sf-mono">{copy.attest.onChain}</span>
        <div className="sf-rows">
          <Row name={copy.attest.rowTarget} value={<span className="sf-mono">{shortAddress(props.label)}</span>} />
          <Row name={copy.attest.rowVerdict} value={verdictName[verdict]} />
          <Row
            name={copy.attest.rowFlag}
            value={
              flags.length === 0 ? (
                copy.target.none
              ) : (
                <span className="sf-mono">{flags.map(flagLabel).join(', ')}</span>
              )
            }
          />
          <Row name={copy.attest.rowEvidence} value={copy.attest.rowEvidenceValue} />
          <Row name={copy.attest.rowBnb} value={copy.attest.rowBnbValue} />
        </div>
      </section>
      <section className="sf-stack">
        <span className="sf-mono">{copy.attest.gains}</span>
        <div className="sf-rows">
          <Row name={copy.attest.rowReward} value={reward[verdict]} />
          <Row name={copy.attest.rowRisk} value={risk[verdict]} />
        </div>
        {verdict === 'SAFE' && <p className="sf-lead">{copy.attest.safeSummary}</p>}
      </section>
      <section className="sf-stack">
        <p className="sf-opt__title">{copy.attest.permanent}</p>
        <p className="sf-lead">{copy.attest.claimable}</p>
        <p className="sf-lead">{quota}</p>
        {props.underDispute && (
          <>
            <p className="sf-lead">{copy.attest.disputeNoteXp}</p>
            <p className="sf-lead">{copy.attest.disputeNoteJury}</p>
          </>
        )}
      </section>
      <footer className="sf-panel__footer">
        <div className="sf-rows">
          <Row name={copy.attest.approveEvidence} value={copy.attest.noGas} />
          <Row name={copy.attest.approveTransaction} value={copy.attest.gas} />
        </div>
        <AttestButton
          state={props.state}
          error={props.error}
          txHash={props.txHash}
          onSubmit={props.onSubmit}
          onRetry={props.onRetry}
        />
        <Button variant="secondary" onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
