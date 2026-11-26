'use client'
import { useState } from 'react'
import { useDisconnect } from 'wagmi'
import type { Address } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { CONSTANTS } from '@sealflare/shared/rules'
import { Panel } from '../ui/Panel'
import { courtAddress } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { isTxWorking, useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { commitHashFor, saveRevealCode } from '../../lib/revealCode'
import { walletGate } from '../attest/AttestPanel'
import { buttonStateOf } from '../dispute/txButtonState'
import { SummaryStep, VoteStep } from './JoinSteps'
import { RevealCodeStep } from './RevealCodeStep'
import { useJuror } from './useJuror'
import { utcOf } from './schedule'

export type JoinPanelProps = {
  challengeId: string
  /** The commit window ends, and the reveal window opens, at this time. */
  commitEndsAt: string
  revealEndsAt: string
  onClose: () => void
}

type Step = 'vote' | 'summary' | 'code'

const STEP_INDEX: Record<Step, number> = { vote: 0, summary: 1, code: 2 }
const TITLE: Record<Step, string> = { vote: copy.jury.join, summary: copy.jury.review, code: copy.jury.codeTitle }

/**
 * Commits the vote.
 *
 * The code is kept on this device first, so a reload between the signature and the receipt cannot
 * lose it. The hash is bound to this wallet, and the stake is exactly the stake of the contract.
 * No signature is asked for anywhere on this path.
 */
function useCommit(challengeId: string, account: Address | null) {
  const tx = useWriteTx()
  const [keptFailed, setKeptFailed] = useState(false)
  const court = courtAddress()
  const commit = (code: string) => {
    if (account === null || court === null) return
    setKeptFailed(!saveRevealCode(code, account))
    void tx.send({
      account,
      address: court,
      abi: courtAbi,
      functionName: 'commitVote',
      args: [BigInt(challengeId), commitHashFor(code, account)],
      value: CONSTANTS.JURY_STAKE,
    })
  }
  const blocked = account !== null && court === null
  return { tx, keptFailed, commit, blocked }
}

/**
 * The panel of a juror who joins: the vote, the summary, and the reveal code that has to be saved
 * before the commit. The wallet branches come first, because nothing can be committed before the
 * wallet is connected and holds an Agent ID.
 */
export function JoinPanel(props: JoinPanelProps) {
  const user = useUserState()
  const { mutate: disconnect } = useDisconnect()
  const [step, setStep] = useState<Step>('vote')
  const [vote, setVote] = useState<boolean | null>(null)
  const chain = useJuror(props.challengeId)
  const { tx, keptFailed, commit, blocked } = useCommit(props.challengeId, chain.account)
  const from = utcOf(props.commitEndsAt)
  const to = utcOf(props.revealEndsAt)
  const body =
    step === 'vote' ? (
      <VoteStep status={chain.status} noCourt={courtAddress() === null} vote={vote} onVote={setVote} onContinue={() => setStep('summary')} />
    ) : step === 'summary' ? (
      <SummaryStep
        commitEndsAt={props.commitEndsAt}
        revealEndsAt={props.revealEndsAt}
        onBack={() => setStep('vote')}
        onContinue={() => setStep('code')}
      />
    ) : (
      <RevealCodeStep
        challengeId={BigInt(props.challengeId)}
        uphold={vote === true}
        state={blocked ? 'failed' : buttonStateOf(tx.state)}
        error={blocked ? copy.dispute.noCourt : tx.error}
        txHash={tx.txHash}
        window={copy.jury.revealWindow.replace('{from}', from).replace('{to}', to)}
        keptFailed={keptFailed}
        onCommit={commit}
        onBack={() => setStep('summary')}
      />
    )
  return (
    <Panel title={TITLE[step]} marker={copy.jury.step[STEP_INDEX[step]]} onClose={props.onClose} closeDisabled={isTxWorking(tx.state)}>
      {walletGate(user, () => disconnect()) ?? body}
    </Panel>
  )
}
