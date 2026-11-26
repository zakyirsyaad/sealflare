'use client'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import type { AttestState } from './useAttest'

export type AttestButtonProps = {
  state: AttestState
  error: string | null
  txHash: string | null
  onSubmit: () => void
  onRetry: () => void
  /** The text of the button before it is pressed. */
  label?: string
  /** The button cannot be pressed even when nothing is running, for example while a fact is unknown. */
  disabled?: boolean
}

/** The link to the transaction of the vote, once there is one. */
export function TransactionLink({ txHash, children }: { txHash: string; children: React.ReactNode }) {
  return (
    <a className="sf-btn sf-btn--ghost" href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

/**
 * The button that starts the attestation, and the states it takes while it runs.
 *
 * While the wallet is busy the button is locked. A failure names its reason and offers a retry.
 * A vote that landed is shown with the label "Waiting for finality", because the indexer reads it
 * only when the block is final.
 */
export function AttestButton({ state, error, txHash, onSubmit, onRetry, label = copy.attest.submit, disabled = false }: AttestButtonProps) {
  if (state === 'done') {
    return (
      <div className="sf-stack">
        <p className="sf-lead">{copy.common.waitingFinality}</p>
        {txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
      </div>
    )
  }
  if (state === 'failed') {
    return (
      <div className="sf-stack">
        <p role="alert" className="sf-error">{error ?? copy.errors.unknown}</p>
        {txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
        <Button variant="primary" onClick={onRetry}>
          {copy.common.retry}
        </Button>
      </div>
    )
  }
  const busy = state !== 'idle'
  return (
    <div className="sf-stack">
      <Button variant="primary" className="sf-btn--block" disabled={busy || disabled} onClick={onSubmit}>
        {busy ? copy.attest.pending : label}
      </Button>
      {busy && txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
    </div>
  )
}
