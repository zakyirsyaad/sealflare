'use client'
import { BountySummary } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { WrongNetwork } from '../wallet/WrongNetwork'
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
        <p role="alert" className="sf-error">
          {error ?? copy.errors.unknown}
        </p>
        {txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
        <Button variant="primary" onClick={onRetry}>
          {copy.common.retry}
        </Button>
      </div>
    )
  }
  // While the transaction waits for its confirmation, the reader can follow it.
  if (status === 'sending' && txHash !== null) {
    return <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>
  }
  return null
}

/**
 * The settlement of a bounty.
 *
 * The button appears when the window of the bounty has passed, judged by the time of the chain.
 * Anybody may trigger it, and it costs gas. A visitor without a wallet is asked for one
 * instead, because the write cannot be signed without it, and a wallet on the wrong network is
 * offered the switch to BNB Smart Chain.
 */
export function SettleButton({ bounty, now }: SettleButtonProps) {
  const { state, settleBounty } = useBounty()
  const user = useUserState()
  const id = numericId(bounty.id)
  if (now === null || id === null) return null
  if (!canSettle(bounty, new Date(now * 1000))) return null
  if (user.kind === 'no-wallet') return <p className="sf-lead">{copy.bounty.settleWalletNeeded}</p>
  if (user.kind === 'wrong-network') return <WrongNetwork />
  // While the wallet is still being read, nothing is offered that needs it.
  if (user.kind === 'checking') return null
  const busy = state.status === 'sending'
  return (
    <div className="sf-stack">
      <Button variant="primary" disabled={busy} onClick={() => void settleBounty(id)}>
        {busy ? copy.attest.pending : copy.bounty.settle}
      </Button>
      <p className="sf-lead">{copy.bounty.gas}</p>
      <WriteStates status={state.status} error={state.error} txHash={state.txHash} onRetry={() => void settleBounty(id)} />
    </div>
  )
}
