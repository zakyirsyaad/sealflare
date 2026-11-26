'use client'
import { BountySummary } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { TransactionLink } from '../attest/AttestButton'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { canSettle } from '../../lib/bounty/settle'
import { useBounty } from '../../lib/bounty/useBounty'

export type SettleButtonProps = {
  bounty: BountySummary
  /** The time of the chain, in seconds. Null when the chain could not be read. */
  now: number | null
}

/**
 * The id of the bounty on the chain, or null when the indexer gave an id that is not a number.
 *
 * The vault numbers the bounties, and the indexer keeps that number, so the id of a row is the
 * id the settlement is written with. An id that is not a number is never written: the app does
 * not guess which bounty it would settle.
 */
function numericId(id: string): bigint | null {
  if (!/^\d+$/.test(id)) return null
  try {
    return BigInt(id)
  } catch {
    return null
  }
}

/** The states of the write: it is on its way, it failed, or it landed. */
function WriteStates({ status, error, txHash, onRetry }: { status: string; error: string | null; txHash: string | null; onRetry: () => void }) {
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
        <p role="alert">{error ?? copy.errors.unknown}</p>
        <Button variant="primary" onClick={onRetry}>
          {copy.common.retry}
        </Button>
      </div>
    )
  }
  return null
}

/**
 * The settlement of a bounty.
 *
 * The button appears when the window of the bounty has passed, judged by the time of the chain.
 * Anybody may trigger it, and it costs gas. A visitor without a wallet is asked for one
 * instead, because the write cannot be signed without it.
 */
export function SettleButton({ bounty, now }: SettleButtonProps) {
  const { state, settleBounty } = useBounty()
  const user = useUserState()
  const id = numericId(bounty.id)
  if (now === null || id === null) return null
  if (!canSettle(bounty, new Date(now * 1000))) return null
  if (user.kind === 'no-wallet') return <p className="sf-lead">{copy.bounty.settleWalletNeeded}</p>
  return (
    <div className="sf-stack">
      <Button variant="primary" disabled={state.status !== 'idle'} onClick={() => void settleBounty(id)}>
        {copy.bounty.settle}
      </Button>
      <p className="sf-lead">{copy.bounty.gas}</p>
      <WriteStates status={state.status} error={state.error} txHash={state.txHash} onRetry={() => void settleBounty(id)} />
    </div>
  )
}
