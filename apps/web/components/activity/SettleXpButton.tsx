'use client'
import { useReadContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { coreAddress } from '../../lib/chain/addresses'
import { expectedChainId } from '../../lib/chain/config'
import { useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { ActionButton } from './ActionButton'

export type SettleXpButtonProps = {
  account: Address
  targetId: string
  /** The one button of the view that carries the accent. */
  primary?: boolean
}

/** How many attestations one call of settle covers. */
export const SETTLE_PAGE = 50

/**
 * The button that claims the reputation of an attestation.
 *
 * The contract settles a range of attestations, so the call names the page of attestations that
 * holds the vote of the account. The page is the one the index of the vote falls in, so the
 * reputation of that vote is always inside the range. A target that has nothing to settle offers
 * no button at all.
 */
export function SettleXpButton({ account, targetId, primary = false }: SettleXpButtonProps) {
  const tx = useWriteTx()
  const core = coreAddress()
  const enabled = core !== null
  const index = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'attestationIndexOf',
    args: [targetId as Hex, account],
    query: { enabled },
  })
  const pending = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'pendingSettlement',
    args: [targetId as Hex],
    query: { enabled },
  })
  const position = indexOf(index.data)
  const send = () => {
    if (core === null || position === null) return
    const start = pageStart(position)
    void tx.send({ account, address: core, abi: coreAbi, functionName: 'settle', args: [targetId as Hex, start, SETTLE_PAGE] })
  }
  if (position === null || pendingCount(pending.data) === 0) return null
  return (
    <div className="sf-stack">
      <ActionButton
        label={copy.activity.claimAction}
        state={tx.state}
        error={tx.error}
        txHash={tx.txHash}
        disabled={core === null}
        primary={primary}
        onSubmit={send}
      />
      <p className="sf-lead">{copy.activity.settleGas}</p>
    </div>
  )
}

/** The index of the vote of the account, when the chain answered with one. */
function indexOf(data: unknown): number | null {
  if (!Array.isArray(data)) return null
  const [attested, index] = data as [unknown, unknown]
  if (attested !== true || typeof index !== 'number') return null
  return index
}

/** How many attestations of the target are still waiting to be settled. */
function pendingCount(data: unknown): number | null {
  return typeof data === 'number' ? data : null
}

/** The first attestation of the page that holds the vote. */
export function pageStart(index: number): number {
  return Math.floor(index / SETTLE_PAGE) * SETTLE_PAGE
}
