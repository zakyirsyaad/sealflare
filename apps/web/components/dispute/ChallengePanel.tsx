'use client'
import { useState } from 'react'
import { useDisconnect, useReadContract } from 'wagmi'
import { courtAbi } from '@sealflare/shared/abi'
import { FLAGS, type FlagName, type TargetType } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'
import { Panel } from '../ui/Panel'
import { useUserState } from '../../lib/chain/userState'
import { expectedChainId } from '../../lib/chain/config'
import { courtAddress } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { walletGate } from '../attest/AttestPanel'
import {
  addFlag,
  chooseVerdict,
  flagsOf,
  missingQuotes,
  provedFlags,
  removeFlag,
  setQuote,
  shortProofOf,
  travellingScan,
  type Choice,
} from '../attest/choice'
import { isWorking } from '../attest/useAttest'
import { ChallengeReview } from './ChallengeReview'
import { EvidenceStep, FlagsStep } from './ChallengeSteps'
import { useChallenge } from './useChallenge'

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
  const [choice, setChoice] = useState<Choice>(() => chooseVerdict('DANGER', scan?.flags ?? 0))
  const [statement, setStatement] = useState('')
  const forfeit = useForfeit(props.targetId)
  const challenge = useChallenge({
    targetId: props.targetId,
    targetType: props.targetType,
    scan,
    address: 'address' in user ? user.address : null,
  })

  const proved = provedFlags(choice, scan, props.targetId)
  const complete = missingQuotes(choice, proved).length === 0
  const preview = complete ? shortProofOf(choice.flags, choice.quotes, travellingScan(choice, scan, props.targetId)) : ''
  const toggle = (flag: FlagName) =>
    setChoice(current => ((current.flags & FLAGS[flag]) === 0 ? addFlag(current, flag) : removeFlag(current, flag)))
  const submit = () => void challenge.submit({ flags: choice.flags, quotes: choice.quotes, statement })

  const body =
    step === 'flags' ? (
      <FlagsStep targetType={props.targetType} choice={choice} onToggle={toggle} onContinue={() => setStep('evidence')} />
    ) : step === 'evidence' ? (
      <EvidenceStep
        choice={choice}
        provedFlags={proved}
        statement={statement}
        preview={preview}
        canContinue={complete && statement.trim() !== ''}
        onQuote={(flag, quote) => setChoice(current => setQuote(current, flag, quote))}
        onStatement={setStatement}
        onBack={() => setStep('flags')}
        onContinue={() => setStep('review')}
      />
    ) : (
      <ChallengeReview
        label={props.label}
        flags={flagsOf(choice)}
        forfeitBps={forfeit.bps}
        forfeitFailed={forfeit.failed}
        state={challenge.state}
        error={challenge.error}
        txHash={challenge.txHash}
        onSubmit={submit}
        onBack={() => setStep('evidence')}
        onRetry={() => {
          challenge.reset()
          submit()
        }}
      />
    )

  return (
    <Panel
      title={TITLE[step]}
      marker={copy.dispute.step[STEP_INDEX[step]]}
      onClose={props.onClose}
      closeDisabled={isWorking(challenge.state)}
    >
      {walletGate(user, () => disconnect()) ?? body}
    </Panel>
  )
}
