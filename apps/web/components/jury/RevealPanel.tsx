'use client'
import { useMemo, useState } from 'react'
import { useDisconnect } from 'wagmi'
import type { Address } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { Panel } from '../ui/Panel'
import { courtAddress, type ChallengePhase } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { isTxWorking, useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { loadRevealCode } from '../../lib/revealCode'
import { AttestButton } from '../attest/AttestButton'
import { walletGate } from '../attest/AttestPanel'
import { checkRevealCode } from './revealCheck'
import { confirmedView, useConfirmation, type Outcome } from './confirmation'
import { utcOf } from './schedule'
import { useJuror, type JurorState } from './useJuror'

export type RevealPanelProps = {
  challengeId: string
  /** The phase the Court names. Revealing is only offered in the reveal phase. */
  phase: ChallengePhase | null
  /** The commit window ends, and the reveal window opens, at this time. */
  commitEndsAt: string
  onClose: () => void
}

const voteWord = (uphold: boolean): string => copy.jury.yourVote.replace('{vote}', uphold ? copy.jury.uphold : copy.jury.reject)

/** Why nothing can be revealed right now, or null when the juror may reveal. */
function reasonOf(props: RevealPanelProps, juror: JurorState | null): string | null {
  // Without a Court there is nothing to reveal to, so the panel says that instead of asking.
  if (courtAddress() === null) return copy.dispute.noCourt
  if (props.phase === 'COMMIT') return copy.jury.revealNotOpen.replace('{time}', utcOf(props.commitEndsAt))
  if (props.phase === 'AWAITING_CLOSE' || props.phase === 'CLOSED') return copy.jury.revealOver
  if (props.phase === null) return copy.jury.readingCommit
  if (juror !== null && !juror.committed) return copy.jury.notCommitted
  return null
}

type FormProps = {
  challengeId: bigint
  account: Address
  juror: JurorState | null
  tx: ReturnType<typeof useWriteTx>
  /** What the Court says about the reveal after the transaction. */
  outcome: Outcome
}

/**
 * What the reveal needs: the code to use, and the check that runs before a transaction.
 *
 * A pasted code wins over the code kept on this device, and either one is checked against the
 * commit on the chain before a transaction is asked for.
 */
function useReveal({ challengeId, account, juror, tx }: Omit<FormProps, 'outcome'>) {
  const court = courtAddress()
  const [pasted, setPasted] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState<boolean | null>(null)
  // A code that was kept on this device is only offered when it matches the commit.
  const stored = useMemo(() => {
    if (juror === null) return null
    // Of the codes kept on this device, the one that hashes to the commit the Court holds.
    return loadRevealCode(challengeId, account, juror.commitHash)
  }, [challengeId, account, juror])
  const source = pasted.trim() !== '' ? pasted : stored
  const reveal = () => {
    if (source === null || juror === null) return
    // The panel is not offered without a Court, so this only keeps a stray call from sending nothing.
    if (court === null) return
    const checked = checkRevealCode(source, challengeId, account, juror.commitHash)
    if (!checked.ok) return setProblem(checked.message)
    setProblem(null)
    setSent(checked.code.uphold)
    void tx.send({
      account,
      address: court,
      abi: courtAbi,
      functionName: 'revealVote',
      args: [challengeId, checked.code.uphold, checked.code.salt],
    })
  }
  const edit = (text: string) => {
    setPasted(text)
    setProblem(null)
  }
  return { pasted, edit, problem, sent, stored, source, reveal }
}

/** The reveal of one vote: the field for a code from another device, and the button. */
function RevealForm(props: FormProps) {
  const { tx, juror } = props
  const form = useReveal(props)
  const view = confirmedView(tx, props.outcome, copy.jury.revealNotFound)
  return (
    <>
      <p className="sf-lead">{copy.jury.revealWhy}</p>
      {juror === null && <p className="sf-lead">{copy.jury.readingCommit}</p>}
      {form.stored !== null && form.pasted.trim() === '' && <p className="sf-lead">{copy.jury.codeSaved}</p>}
      <label className="sf-opt__title" htmlFor="reveal-paste">
        {copy.jury.pasteCode}
      </label>
      <textarea
        id="reveal-paste"
        className="sf-input sf-textarea"
        rows={3}
        spellCheck={false}
        autoComplete="off"
        value={form.pasted}
        onChange={event => form.edit(event.target.value)}
      />
      {form.problem !== null && (
        <p role="alert" className="sf-error">
          {form.problem}
        </p>
      )}
      {view.checking && <p className="sf-lead" role="status">{copy.jury.revealVerifying}</p>}
      {view.state === 'done' && form.sent !== null && <p className="sf-opt__title">{voteWord(form.sent)}</p>}
      <footer className="sf-panel__footer">
        <AttestButton
          state={view.state}
          error={view.error}
          txHash={tx.txHash}
          label={copy.jury.reveal}
          disabled={form.source === null || juror === null}
          onSubmit={form.reveal}
          onRetry={() => {
            tx.reset()
            form.reveal()
          }}
        />
      </footer>
    </>
  )
}

/** What the juror sees when there is nothing to reveal: why, and the vote if it is already open. */
function Nothing({ reason, juror }: { reason: string; juror: JurorState | null }) {
  return (
    <>
      <p className="sf-lead">{reason}</p>
      {juror?.revealed === true && <p className="sf-opt__title">{voteWord(juror.uphold)}</p>}
    </>
  )
}

/**
 * The panel of a juror who reveals. It is only offered in the reveal phase, to a juror who
 * committed and has not revealed yet. The wallet branches come first.
 */
export function RevealPanel(props: RevealPanelProps) {
  const user = useUserState()
  const { mutate: disconnect } = useDisconnect()
  const chain = useJuror(props.challengeId)
  const tx = useWriteTx()
  // The reveal counts once the Court says the vote is open, not when a receipt comes back.
  const outcome = useConfirmation(tx.state, chain.refetch, chain.juror, juror => juror?.revealed === true)
  const reason = reasonOf(props, chain.juror)
  const revealed = chain.juror?.revealed === true
  // A reveal that was sent keeps its form, so the answer of the chain cannot take it away
  // while the transaction is still being confirmed.
  const sending = tx.state !== 'idle'
  const body =
    reason !== null && !sending ? (
      <Nothing reason={reason} juror={chain.juror} />
    ) : revealed && !sending ? (
      <Nothing reason={copy.jury.alreadyRevealed} juror={chain.juror} />
    ) : chain.account === null ? null : (
      <RevealForm challengeId={BigInt(props.challengeId)} account={chain.account} juror={chain.juror} tx={tx} outcome={outcome} />
    )
  return (
    <Panel title={copy.jury.revealTitle} onClose={props.onClose} closeDisabled={isTxWorking(tx.state)}>
      {walletGate(user, () => disconnect()) ?? body}
    </Panel>
  )
}
