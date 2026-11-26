'use client'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import type { TxState } from '../../lib/chain/useWriteTx'

export type ActionButtonProps = {
  label: string
  state: TxState
  error: string | null
  txHash: string | null
  /** The action cannot be used now, for example because the vault is not open yet. */
  disabled?: boolean
  /** The one button of the view that carries the accent. */
  primary?: boolean
  onSubmit: () => void
}

/**
 * The button of one action on the My activity screen.
 *
 * While the wallet is busy the button is locked. A failure names its reason and offers a retry.
 * An action that landed is shown with the label "Waiting for finality", because the indexer reads
 * it only when the block is final.
 */
export function ActionButton({ label, state, error, txHash, disabled = false, primary = false, onSubmit }: ActionButtonProps) {
  if (state === 'done') {
    return (
      <div className="sf-stack">
        <p className="sf-lead">{copy.common.waitingFinality}</p>
        {txHash !== null && (
          <a className="sf-btn sf-btn--ghost" href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">
            {copy.target.transaction}
          </a>
        )}
      </div>
    )
  }
  if (state === 'failed') {
    return (
      <div className="sf-stack">
        <p role="alert" className="sf-lead">{error ?? copy.errors.unknown}</p>
        <Button variant={primary ? 'primary' : 'secondary'} onClick={onSubmit}>{copy.common.retry}</Button>
      </div>
    )
  }
  const busy = state === 'signing' || state === 'pending'
  return (
    <Button variant={primary ? 'primary' : 'secondary'} disabled={disabled || busy} onClick={onSubmit}>
      {busy ? copy.common.waitingConfirmation : label}
    </Button>
  )
}
