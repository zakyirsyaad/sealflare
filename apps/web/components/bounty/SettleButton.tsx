'use client'
import { BountySummary } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
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
 * id the settlement is written with.
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
 * Anybody may trigger it, and it costs gas.
 */
export function SettleButton({ bounty, now }: SettleButtonProps) {
  const { state, settleBounty } = useBounty()
  const id = numericId(bounty.id)
  if (now === null || id === null) return null
  if (!canSettle(bounty, new Date(now * 1000))) return null
  return (
    <div className="sf-stack">
      <Button variant="primary" disabled={state.status === 'sending'} onClick={() => void settleBounty(id)}>
        {copy.bounty.settle}
      </Button>
      <p className="sf-lead">{copy.bounty.gas}</p>
      {state.status === 'done' && <p>{copy.common.waitingFinality}</p>}
      {state.error !== null && <p role="alert">{state.error}</p>}
    </div>
  )
}
