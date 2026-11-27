'use client'
import type { BountySummary } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { ConnectSection } from '../wallet/ConnectSection'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { canSettle } from '../../lib/bounty/settle'
import { useBounty } from '../../lib/bounty/useBounty'
import { WriteStates } from './WriteStates'

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

/**
 * The settlement of a bounty.
 *
 * The button appears when the window of the bounty has passed, judged by the time of the chain.
 * Anybody may trigger it, and it costs gas. A visitor without a wallet is asked for one
 * instead, because the write cannot be signed without it, and a wallet on the wrong network is
 * offered the switch to BNB Smart Chain.
 */
export function SettleButton({ bounty, now }: SettleButtonProps) {
  const { status, error, txHash, settleBounty } = useBounty()
  const user = useUserState()
  const id = numericId(bounty.id)
  if (now === null || id === null) return null
  if (!canSettle(bounty, new Date(now * 1000))) return null
  if (user.kind === 'no-wallet') return <ConnectSection what={copy.bounty.settleWalletNeeded} />
  if (user.kind === 'wrong-network') return <WrongNetwork />
  // While the wallet is still being read, nothing is offered that needs it.
  if (user.kind === 'checking') return null
  // The account signs the write, so it is named in the request.
  const account = user.kind === 'no-agent-id' || user.kind === 'holder' ? user.address : null
  const busy = status === 'signing' || status === 'pending'
  // The id is a number now, so the write names the bounty it settles.
  const bountyId = id
  function settle(): void {
    if (account === null) return
    void settleBounty(account, bountyId)
  }
  return (
    <div className="sf-stack">
      {(status === 'idle' || busy) && (
        <Button variant="primary" disabled={busy || account === null} onClick={settle}>
          {busy ? copy.attest.pending : copy.bounty.settle}
        </Button>
      )}
      <p className="sf-lead">{copy.bounty.gas}</p>
      <WriteStates status={status} error={error} txHash={txHash} onRetry={settle} />
    </div>
  )
}
