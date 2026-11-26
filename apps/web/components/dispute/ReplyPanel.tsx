'use client'
import { useState } from 'react'
import { useDisconnect } from 'wagmi'
import { Panel } from '../ui/Panel'
import type { ChallengePhase } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import type { PublisherRole } from '../../server/disputes'
import { AttestButton } from '../attest/AttestButton'
import { walletGate } from '../attest/AttestPanel'
import { isLocked } from '../attest/useAttest'
import { StatementField } from './ChallengeSteps'
import { useReply } from './useReply'

export type ReplyPanelProps = {
  challengeId: string
  targetId: string
  /** The phase the Court names. Null when the chain has not answered. */
  phase: ChallengePhase | null
  /** What the registry says about the publisher. Null when it could not be read. */
  publisherRole: PublisherRole | null
  /** The address of the verified publisher. Null when there is none. */
  publisher: string | null
  onClose: () => void
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
 * The reply of the verified publisher: the explanation, pinned to IPFS without gas, then the
 * transaction that links it to the dispute.
 */
export function ReplyPanel(props: ReplyPanelProps) {
  const user = useUserState()
  const { mutate: disconnect } = useDisconnect()
  const [statement, setStatement] = useState('')
  const reply = useReply({
    challengeId: props.challengeId,
    targetId: props.targetId,
    address: 'address' in user ? user.address : null,
    phase: props.phase,
    publisherRole: props.publisherRole,
    publisher: props.publisher,
  })
  const submit = () => void reply.submit(statement)
  const body = (
    <>
      <StatementField statement={statement} onStatement={setStatement} />
      <section className="sf-stack">
        <span className="sf-mono">{copy.attest.onChain}</span>
        <div className="sf-rows">
          <Row name={copy.attest.rowEvidence} value={copy.dispute.replyChain} />
          <Row name={copy.attest.rowBnb} value={copy.attest.rowBnbValue} />
        </div>
        <p className="sf-lead">{copy.dispute.replyNote}</p>
      </section>
      <footer className="sf-panel__footer">
        <p className="sf-lead">{copy.attest.twoApprovals}</p>
        <AttestButton
          state={reply.state}
          error={reply.error}
          txHash={reply.txHash}
          label={copy.dispute.replySubmit}
          disabled={statement.trim() === ''}
          onSubmit={submit}
          onRetry={() => {
            reply.reset()
            submit()
          }}
        />
      </footer>
    </>
  )
  return (
    <Panel title={copy.dispute.submitReply} onClose={props.onClose} closeDisabled={isLocked(reply.state)}>
      {walletGate(user, () => disconnect()) ?? body}
    </Panel>
  )
}
