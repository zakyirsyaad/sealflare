'use client'
import { useEffect, useState } from 'react'
import { useConnect, useConnectors, useDisconnect } from 'wagmi'
import type { ScanReport } from '@sealflare/shared/schemas'
import { CONSTANTS, type FlagName, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { NoAgentId } from '../wallet/NoAgentId'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { useUserState } from '../../lib/chain/userState'
import { agentIdUrl } from '../../lib/chain/config'
import { copy } from '../../lib/copy'
import { usePendingVote } from '../target/pendingVote'
import { ReviewStep } from './ReviewStep'
import { VerdictStep } from './VerdictStep'
import { addFlag, canReview, chooseVerdict, emptyChoice, provedFlags, removeFlag, setQuote, type Choice } from './choice'
import { useAttest } from './useAttest'

export type AttestPanelProps = {
  targetId: string
  /** The word `Core.attest` takes. Null when the target is not known yet. */
  targetWord: string | null
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** The name of the target, as the page shows it. */
  label: string
  tier: TrustTier
  scan: ScanReport | null
  /** A challenge is open on this target. */
  underDispute: boolean
  /**
   * Whether the dialog is shown. The page keeps this component mounted while the dialog is closed,
   * so the attempt, the choice and the step outlive the dialog, and closing it never loses a vote
   * that is on its way. It is shown by default.
   */
  open?: boolean
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

type Step = 'verdict' | 'review'
type UserState = ReturnType<typeof useUserState>
type Attestation = ReturnType<typeof useAttest>

/** What stands between the user and the vote before the wallet may be used: a connection, the network or an Agent ID. */
function walletGate(user: UserState, disconnect: () => void): React.ReactNode {
  if (user.kind === 'no-wallet') return <ConnectSection />
  if (user.kind === 'wrong-network') return <WrongNetwork />
  if (user.kind === 'checking') return <p className="sf-lead">{copy.wallet.checkingAgentId}</p>
  if (user.kind === 'no-agent-id') {
    return <NoAgentId recheck={user.recheck} onOtherWallet={disconnect} agentIdUrl={agentIdUrl} />
  }
  return null
}

/**
 * Tells the page about the vote as soon as the receipt is good, so it shows before the indexer has
 * it, and reads the quota and the vote of the wallet again so the Attest button follows the chain.
 */
function useRegisterVote(attest: Attestation, recheck: () => void) {
  const { register } = usePendingVote()
  const { state, txHash, verdict, account } = attest
  useEffect(() => {
    if (state !== 'done' || txHash === null || verdict === null || account === null) return
    register(verdict, txHash, account)
    recheck()
    // The wallet is read again once per vote. A new `recheck` function must not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, txHash, verdict, account, register])
}

type Pane = {
  props: AttestPanelProps
  choice: Choice
  setChoice: (choice: Choice) => void
}

/** The first step, wired to the choice. */
function VerdictPane({ props, choice, setChoice, onContinue }: Pane & { onContinue: () => void }) {
  const scanFlags = props.scan?.flags ?? 0
  // Only the flags whose excerpt travels with the report are proved. Every other flag waits for
  // a quote the Guardian writes, so no line on-chain is ever empty.
  const proved = provedFlags(choice, props.scan, props.targetId)
  return (
    <VerdictStep
      choice={choice}
      scanFlags={scanFlags}
      suggestion={props.scan?.suggestedVerdict ?? null}
      tier={props.tier}
      targetType={props.targetType}
      provedFlags={proved}
      canContinue={canReview(choice, proved, props.targetType)}
      onChoose={(verdict: Verdict) => setChoice(chooseVerdict(verdict, scanFlags, choice.quotes))}
      onAddFlag={(flag: FlagName) => setChoice(addFlag(choice, flag))}
      onRemoveFlag={(flag: FlagName) => setChoice(removeFlag(choice, flag))}
      onQuote={(flag: FlagName, quote: string) => setChoice(setQuote(choice, flag, quote))}
      onContinue={onContinue}
    />
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
  const [step, setStep] = useState<Step>('verdict')
  const [choice, setChoice] = useState<Choice>(emptyChoice)
  const { mutate: disconnect } = useDisconnect()
  const attest = useAttest({
    targetId: props.targetId,
    targetWord: props.targetWord,
    targetType: props.targetType,
    tier: props.tier,
    scan: props.scan,
    address: 'address' in user ? user.address : null,
  })
  useRegisterVote(attest, user.recheck)

  const submit = () => {
    if (choice.verdict === null) return
    void attest.submit({ verdict: choice.verdict, flags: choice.flags, quotes: choice.quotes })
  }
  const review = (
    <ReviewStep
      label={props.label}
      choice={choice}
      attestationsLeft={user.kind === 'holder' ? user.attestationsLeft : null}
      limit={CONSTANTS.DAILY_ATTEST_LIMIT}
      state={attest.state}
      error={attest.error}
      txHash={attest.txHash}
      underDispute={props.underDispute}
      onSubmit={submit}
      onBack={() => setStep('verdict')}
      onRetry={() => {
        attest.reset()
        submit()
      }}
    />
  )
  const verdict = <VerdictPane props={props} choice={choice} setChoice={setChoice} onContinue={() => setStep('review')} />
  if (props.open === false) return null
  return (
    <Panel
      title={step === 'verdict' ? copy.attest.action : copy.attest.review}
      marker={copy.attest.step[step === 'verdict' ? 0 : 1]}
      onClose={props.onClose}
    >
      {walletGate(user, () => disconnect()) ?? (step === 'verdict' ? verdict : review)}
    </Panel>
  )
}
