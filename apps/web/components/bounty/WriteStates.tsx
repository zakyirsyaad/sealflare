'use client'
import { Button } from '../ui/Button'
import { TransactionLink } from '../attest/AttestButton'
import type { TxState } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'

export type WriteStatesProps = {
  status: TxState
  error: string | null
  /** The hash of the transaction, as soon as the wallet has signed it. */
  txHash: string | null
  /** Starts the attempt again. */
  onRetry: () => void
}

/**
 * The states of a write: it is on its way, it failed, or it landed.
 *
 * A retry is only offered when nothing was sent on-chain. Once the wallet has signed, the
 * transaction may still be on its way, and a second one would fund a second bounty, so the
 * reader is sent to the explorer instead.
 */
export function WriteStates({ status, error, txHash, onRetry }: WriteStatesProps) {
  if (status === 'done') {
    return (
      <div className="sf-stack">
        <p>{copy.common.waitingFinality}</p>
        {txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="sf-stack">
        <p role="alert" className="sf-error">
          {error ?? copy.errors.unknown}
        </p>
        {txHash !== null ? (
          <>
            <p className="sf-lead">{copy.bounty.txSent}</p>
            <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>
          </>
        ) : (
          <Button variant="primary" onClick={onRetry}>
            {copy.common.retry}
          </Button>
        )}
      </div>
    )
  }
  // While the transaction waits for its confirmation, the reader can follow it.
  if (status === 'pending' && txHash !== null) {
    return (
      <div className="sf-stack">
        <p className="sf-lead">{copy.bounty.txPending}</p>
        <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>
      </div>
    )
  }
  return null
}
