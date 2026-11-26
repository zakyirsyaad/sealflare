'use client'
import { useState } from 'react'
import { useDisconnect, useReadContract } from 'wagmi'
import { courtAbi } from '@sealflare/shared/abi'
import type { TargetType } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'
import { Panel } from '../ui/Panel'
import { useUserState } from '../../lib/chain/userState'
import { expectedChainId } from '../../lib/chain/config'
import { courtAddress } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { walletGate } from '../attest/AttestPanel'
import { flagsOf } from '../attest/choice'
import { isLocked } from '../attest/useAttest'
import { ChallengeReview } from './ChallengeReview'
import { EvidenceStep, FlagsStep } from './ChallengeSteps'
import { useChallenge } from './useChallenge'
import { useChallengeDraft } from './useChallengeDraft'

export type ChallengePanelProps = {
  targetId: string
  targetType: TargetType
  /** The name of the target, as the page shows it. */
  label: string
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  onClose: () => void
}

type Step = 'flags' | 'evidence' | 'review'

const STEP_INDEX: Record<Step, number> = { flags: 0, evidence: 1, review: 2 }
const TITLE: Record<Step, string> = {
  flags: copy.dispute.action,
  evidence: copy.dispute.evidenceTitle,
  review: copy.dispute.review,
}

/** The share of the stake that is forfeited if the dispute expires, as the Court names it for this target. */
function useForfeit(targetId: string) {
  const court = courtAddress()
  const read = useReadContract({
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    functionName: 'nextExpireForfeitBps',
    args: [targetId as `0x${string}`],
    query: { enabled: court !== null },
  })
  return { bps: typeof read.data === 'number' ? read.data : null, failed: read.isError === true || court === null }
}

type BodyProps = {
  step: Step
  onStep: (step: Step) => void
  props: Omit<ChallengePanelProps, 'scan'>
  draft: ReturnType<typeof useChallengeDraft>
  forfeit: ReturnType<typeof useForfeit>
  challenge: ReturnType<typeof useChallenge>
  submit: () => void
}

/** The step that is shown: the flags, the evidence or the review. */
function Body({ step, onStep, props, draft, forfeit, challenge, submit }: BodyProps) {
  if (step === 'flags') {
    return <FlagsStep targetType={props.targetType} choice={draft.choice} onToggle={draft.toggle} onContinue={() => onStep('evidence')} />
  }
  if (step === 'evidence') {
    return (
      <EvidenceStep
        choice={draft.choice}
        provedFlags={draft.proved}
        statement={draft.statement}
        preview={draft.preview}
        canContinue={draft.canContinue}
        onQuote={draft.quote}
        onStatement={draft.setStatement}
        onBack={() => onStep('flags')}
        onContinue={() => onStep('review')}
      />
    )
  }
  return (
    <ChallengeReview
      label={props.label}
      flags={flagsOf(draft.choice)}
      forfeitBps={forfeit.bps}
      forfeitFailed={forfeit.failed}
      state={challenge.state}
      error={challenge.error}
      txHash={challenge.txHash}
      onSubmit={submit}
      onBack={() => onStep('evidence')}
      onRetry={() => {
        challenge.reset()
        submit()
      }}
    />
  )
}

/**
 * The challenge panel.
 *
 * Three steps: the flags, the evidence and the review. The wallet branches come first, because
 * nothing can be signed before the wallet is connected and holds an Agent ID. The flags of the
 * scan are ticked from the start, and the verdict is always the danger rule of the Court.
 */
export function ChallengePanel({ scan: offered, ...props }: ChallengePanelProps) {
  // A scan of another target must not tick flags here or travel with the report.
  const scan = offered !== null && offered.targetId === props.targetId ? offered : null
  const user = useUserState()
  const { mutate: disconnect } = useDisconnect()
  const [step, setStep] = useState<Step>('flags')
  const draft = useChallengeDraft(scan, props.targetId)
  const forfeit = useForfeit(props.targetId)
  const challenge = useChallenge({
    targetType: props.targetType,
    targetId: props.targetId,
    scan,
    address: 'address' in user ? user.address : null,
  })
  const submit = () =>
    void challenge.submit({ flags: draft.choice.flags, quotes: draft.choice.quotes, statement: draft.statement })
  return (
    <Panel
      title={TITLE[step]}
      marker={copy.dispute.step[STEP_INDEX[step]]}
      onClose={props.onClose}
      closeDisabled={isLocked(challenge.state)}
    >
      {walletGate(user, () => disconnect()) ?? (
        <Body step={step} onStep={setStep} props={props} draft={draft} forfeit={forfeit} challenge={challenge} submit={submit} />
      )}
    </Panel>
  )
}
