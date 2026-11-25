'use client'
import { useState } from 'react'
import { useConnect, useConnectors, useDisconnect } from 'wagmi'
import type { AttestationRow, ScanReport } from '@sealflare/shared/schemas'
import type { FlagName, TrustTier, Verdict } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { NoAgentId } from '../wallet/NoAgentId'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { useUserState } from '../../lib/chain/userState'
import { agentIdUrl } from '../../lib/chain/config'
import { CONSTANTS } from '@sealflare/shared/rules'
import { copy } from '../../lib/copy'
import { ReviewStep } from './ReviewStep'
import { VerdictStep } from './VerdictStep'
import { addFlag, canReview, chooseVerdict, emptyChoice, removeFlag, setQuote, shortProofOf, type Choice } from './choice'
import { useAttest } from './useAttest'

export type AttestPanelProps = {
  targetId: string
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** The name of the target, as the page shows it. */
  label: string
  tier: TrustTier
  scan: ScanReport | null
  /** The votes on this target, to find the one of this user. */
  attestations: AttestationRow[]
  /** A challenge is open on this target. */
  underDispute: boolean
  onClose: () => void
}

/** The wallet has to be connected before anything can be signed. */
function ConnectSection() {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  return (
    <section className="sf-stack">
      <h3 className="sf-stack__title">{copy.wallet.connectTitle}</h3>
      <p className="sf-lead">{copy.wallet.connectIntro}</p>
      <ul className="sf-connectors">
        {connectors.map(connector => (
          <li key={connector.uid}>
            <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector })}>
              {connector.name}
            </Button>
          </li>
        ))}
      </ul>
      {error !== null && error !== undefined && <p role="alert" className="sf-lead">{copy.wallet.connectFailed}</p>}
    </section>
  )
}

/**
 * The attest panel.
 *
 * It opens beside the target page and walks the Guardian through two steps: the verdict and the
 * summary of what is written on-chain. The wallet branches come first, because nothing can be
 * signed before the wallet is connected and holds an Agent ID.
 */
export function AttestPanel(props: AttestPanelProps) {
  const user = useUserState()
  const [step, setStep] = useState<'verdict' | 'review'>('verdict')
  const [choice, setChoice] = useState<Choice>(emptyChoice)
  const { mutate: disconnect } = useDisconnect()
  const address = 'address' in user ? user.address : null
  const attest = useAttest({
    targetId: props.targetId,
    targetType: props.targetType,
    scan: props.scan,
    address,
  })
  const scanFlags = props.scan?.flags ?? 0
  const left = user.kind === 'holder' ? user.attestationsLeft : null

  const submit = () => {
    if (choice.verdict === null) return
    void attest.submit({
      verdict: choice.verdict,
      flags: choice.flags,
      shortProof: shortProofOf(choice, props.scan),
    })
  }

  const retry = () => {
    attest.reset()
    submit()
  }

  const body = () => {
    if (user.kind === 'no-wallet') return <ConnectSection />
    if (user.kind === 'wrong-network') return <WrongNetwork />
    if (user.kind === 'checking') return <p className="sf-lead">{copy.wallet.checkingAgentId}</p>
    if (user.kind === 'no-agent-id') {
      return <NoAgentId recheck={user.recheck} onOtherWallet={() => disconnect()} agentIdUrl={agentIdUrl} />
    }
    if (step === 'verdict') {
      return (
        <VerdictStep
          choice={choice}
          scanFlags={scanFlags}
          suggestion={props.scan?.suggestedVerdict ?? null}
          tier={props.tier}
          targetType={props.targetType}
          canContinue={canReview(choice, scanFlags)}
          onChoose={(verdict: Verdict) => setChoice(chooseVerdict(verdict, scanFlags))}
          onAddFlag={(flag: FlagName) => setChoice(addFlag(choice, flag))}
          onRemoveFlag={(flag: FlagName) => setChoice(removeFlag(choice, flag))}
          onQuote={(flag: FlagName, quote: string) => setChoice(setQuote(choice, flag, quote))}
          onContinue={() => setStep('review')}
        />
      )
    }
    return (
      <ReviewStep
        label={props.label}
        choice={choice}
        attestationsLeft={left}
        limit={CONSTANTS.DAILY_ATTEST_LIMIT}
        state={attest.state}
        error={attest.error}
        txHash={attest.txHash}
        voted={attest.verdict}
        underDispute={props.underDispute}
        onSubmit={submit}
        onBack={() => setStep('verdict')}
        onRetry={retry}
      />
    )
  }

  return (
    <Panel title={step === 'verdict' ? copy.attest.action : copy.attest.review} onClose={props.onClose}>
      <p className="sf-mono">{copy.attest.step[step === 'verdict' ? 0 : 1]}</p>
      {body()}
    </Panel>
  )
}
