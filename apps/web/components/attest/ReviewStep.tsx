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

/** The wallet or the chain is still working on the vote, so the summary cannot be left. */
function working(state: AttestState): boolean {
  return state === 'signing-evidence' || state === 'uploading' || state === 'signing-tx' || state === 'pending'
}

/** An address is shortened, a repository name is not. */
function labelOf(label: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(label) ? shortAddress(label) : label
}

function Row({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="sf-rows__row">
      <span className="sf-rows__name">{name}</span>
      <span className="sf-rows__value">{value}</span>
    </div>
  )
}

/** What is written on-chain, row by row. */
function OnChainSection({ label, choice }: { label: string; choice: Choice }) {
  const flags = flagsOf(choice)
  const verdict = choice.verdict as Verdict
  return (
    <section className="sf-stack">
      <span className="sf-mono">{copy.attest.onChain}</span>
      <div className="sf-rows">
        <Row name={copy.attest.rowTarget} value={<span className="sf-mono">{labelOf(label)}</span>} />
        <Row name={copy.attest.rowVerdict} value={verdictName[verdict]} />
        <Row
          name={copy.attest.rowFlag}
          value={flags.length === 0 ? copy.target.none : <span className="sf-mono">{flags.join(', ')}</span>}
        />
        <Row name={copy.attest.rowEvidence} value={copy.attest.rowEvidenceValue} />
        <Row name={copy.attest.rowBnb} value={copy.attest.rowBnbValue} />
      </div>
    </section>
  )
}

/** What the vote is worth and what it risks. */
function GainsSection({ verdict }: { verdict: Verdict }) {
  return (
    <section className="sf-stack">
      <span className="sf-mono">{copy.attest.gains}</span>
      <div className="sf-rows">
        <Row name={copy.attest.rowReward} value={reward[verdict]} />
        <Row name={copy.attest.rowRisk} value={risk[verdict]} />
      </div>
      {verdict === 'SAFE' && <p className="sf-lead">{copy.attest.safeSummary}</p>}
    </section>
  )
}

/** What may not be changed afterwards, and the quota that is left. */
function PermanentSection(props: { attestationsLeft: number | null; limit: number; underDispute: boolean }) {
  const quota = (props.attestationsLeft === null ? copy.target.quotaDefault : copy.target.quotaLeft)
    .replace('{left}', String(props.attestationsLeft))
    .replace('{limit}', String(props.limit))
  return (
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
  if (choice.verdict === null) return null
  return (
    <>
      <OnChainSection label={props.label} choice={choice} />
      <GainsSection verdict={choice.verdict} />
      <PermanentSection attestationsLeft={props.attestationsLeft} limit={props.limit} underDispute={props.underDispute} />
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
        <Button variant="secondary" disabled={working(props.state)} onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
