'use client'
import type { ChallengeDetail } from '@sealflare/shared/schemas'
import { Chip } from '../ui/Chip'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { modulesLive } from '../../lib/chain/config'
import { copy } from '../../lib/copy'
import { targetLabel } from '../../lib/format'
import type { PublisherRole } from '../../server/disputes'
import { EvidenceBox } from './EvidenceBox'
import { JuryActions } from '../jury/JuryActions'
import { JuryBox, JurorsTable } from './JuryBox'
import { Outcomes } from './Outcomes'
import { PayoutTable } from './PayoutTable'
import { PhaseStrip } from './PhaseStrip'
import { ReplyBox } from './ReplyBox'
import { SettleActions } from './SettleActions'
import { outcomeWord, phaseWord, verdictText } from './labels'
import { useChallengeChain, type ChallengeChain } from './useChallengeChain'
import { useNow } from './useNow'

export type DisputeScreenProps = {
  detail: ChallengeDetail | null
  /** What the registry says about the publisher. Null when it could not be read. */
  publisherRole: PublisherRole | null
  publisher: string | null
  failed: boolean
}

/** The ending of a closed dispute: the verdict, the weight on each side and who received what. */
function Verdict({ detail, outcome }: { detail: ChallengeDetail; outcome: ChallengeDetail['outcome'] }) {
  return (
    <section className="sf-frame sf-evidence" aria-label={copy.dispute.verdict}>
      <div className="sf-rows__row sf-evidence__head">
        <span className="sf-mono">{copy.dispute.verdict}</span>
        <span className="sf-mono">{outcomeWord(outcome)}</span>
      </div>
      <div className="sf-stack sf-evidence__body">
        <p className="sf-opt__title">{verdictText(outcome)}</p>
        <div className="sf-rows">
          <div className="sf-rows__row">
            <span className="sf-rows__name">{copy.dispute.weightUphold}</span>
            <span className="sf-rows__value sf-mono">{detail.upholdWeight}</span>
          </div>
          <div className="sf-rows__row">
            <span className="sf-rows__name">{copy.dispute.weightReject}</span>
            <span className="sf-rows__value sf-mono">{detail.rejectWeight}</span>
          </div>
        </div>
        <PayoutTable payouts={detail.payouts} />
      </div>
    </section>
  )
}

/** The title row: the number, the target, the phase and the way back to the target. */
function Header({ detail, phase, outcome }: { detail: ChallengeDetail; phase: ChallengeDetail['phase'] | 'NONE'; outcome: ChallengeDetail['outcome'] }) {
  return (
    <div className="sf-identity">
      <h1 className="sf-identity__label">
        {copy.dispute.disputeTitle} <span className="sf-mono">#{detail.id}</span>
      </h1>
      <Chip className="sf-mono">{targetLabel(detail.label)}</Chip>
      <Chip>{phaseWord(phase, outcome)}</Chip>
      <span className="sf-identity__spacer" />
      <a className="sf-btn sf-btn--ghost" href={`/app/t/${detail.targetId}`}>
        {copy.dispute.viewTarget}
      </a>
    </div>
  )
}

/** The column beside the evidence: the jury, what a juror can do, and what anyone can do to close the dispute. */
function Side({ detail, chain, phase }: { detail: ChallengeDetail; chain: ChallengeChain; phase: ChallengeDetail['phase'] | 'NONE' }) {
  return (
    <div className="sf-dispute__side">
      <JuryBox phase={phase} commits={chain.commits ?? detail.commits} reveals={chain.reveals ?? detail.reveals}>
        <JuryActions
          challengeId={detail.id}
          phase={chain.phase}
          commitEndsAt={detail.commitEndsAt}
          revealEndsAt={detail.revealEndsAt}
        />
      </JuryBox>
      <SettleActions
        challengeId={detail.id}
        targetId={detail.targetId}
        phase={chain.phase}
        outcome={chain.outcome}
        reveals={chain.reveals}
      />
    </div>
  )
}

/** The dispute, read from the index and followed on the chain. The phase is the Court's. */
function DisputeBody({ detail, publisherRole, publisher }: DisputeScreenProps & { detail: ChallengeDetail }) {
  const now = useNow()
  const chain = useChallengeChain(detail.id)
  // The index only fills the gap until the chain answers. It never decides what the page offers.
  const phase = chain.phase ?? detail.phase
  const outcome = chain.outcome ?? detail.outcome
  const closed = phase === 'CLOSED'
  return (
    <div className="sf-target sf-dispute">
      <Header detail={detail} phase={phase} outcome={outcome} />
      <PhaseStrip phase={chain.phase} commitEndsAt={detail.commitEndsAt} revealEndsAt={detail.revealEndsAt} now={now} />
      <div className="sf-target__body">
        <div className="sf-dispute__main">
          <div className="sf-dispute__pair">
            <EvidenceBox
              challenger={detail.challenger}
              flags={detail.flags}
              shortProof={detail.shortProof}
              evidenceURI={detail.evidenceURI}
            />
            <ReplyBox
              challengeId={detail.id}
              targetId={detail.targetId}
              phase={chain.phase}
              publisherRole={publisherRole}
              publisher={publisher}
              counterEvidenceURI={detail.counterEvidenceURI}
              commitEndsAt={detail.commitEndsAt}
              now={now}
            />
          </div>
          {!closed && phase !== 'NONE' && <Outcomes />}
          {closed && <Verdict detail={detail} outcome={outcome} />}
          {phase !== 'COMMIT' && phase !== 'NONE' && <JurorsTable jurors={detail.jurors} />}
        </div>
        <Side detail={detail} chain={chain} phase={phase} />
      </div>
    </div>
  )
}

/**
 * The page of one dispute.
 *
 * It says plainly when the dispute is not found or could not be read, and it never invents one.
 * Before the Court and the Vault are live there is nothing to show.
 */
export function DisputeScreen(props: DisputeScreenProps) {
  if (!modulesLive) return <EmptyState title={copy.common.modulesNotLive} />
  if (props.failed) {
    return <ErrorState what={copy.dispute.pageFailed} onChainSafe onRetry={() => window.location.reload()} />
  }
  if (props.detail === null) {
    return (
      <EmptyState
        title={copy.dispute.notFound}
        action={
          <a className="sf-btn sf-btn--secondary" href="/app/disputes">
            {copy.dispute.listTitle}
          </a>
        }
      />
    )
  }
  return <DisputeBody {...props} detail={props.detail} />
}
