'use client'
import { useCallback, useEffect, useRef } from 'react'
import { useReadContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { coreAddress } from '../../lib/chain/addresses'
import { expectedChainId } from '../../lib/chain/config'
import { useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { ActionButton } from './ActionButton'

export type SettleXpButtonProps = {
  account: Address
  targetId: string
  /** The one button of the view that carries the accent. */
  primary?: boolean
  /** Called once a settlement was mined, so the rows of the account are read again. */
  onSettled?: () => void
}

/** How many attestations one call of settle covers. */
export const SETTLE_PAGE = 50

/**
 * The button that claims the reputation of an attestation.
 *
 * The contract settles a range of attestations, so the call names the page of attestations that
 * holds the vote of the account. The page is the one the index of the vote falls in, so the
 * reputation of that vote is always inside the range. A target that has nothing to settle offers
 * no button at all. Once the chain has nothing left to settle, the button is free again.
 */
export function SettleXpButton({ account, targetId, primary = false, onSettled }: SettleXpButtonProps) {
  const tx = useWriteTx()
  const core = coreAddress()
  const reads = useSettleReads(targetId, account)
  const mined = useRef<string | null>(null)
  const { state, txHash, reset } = tx
  useEffect(() => {
    if (state !== 'done' || txHash === null || mined.current === txHash) return
    mined.current = txHash
    onSettled?.()
    reads.refetchPending()
  }, [state, txHash, onSettled, reads.refetchPending])
  useEffect(() => {
    // The chain has nothing left to settle, so the claim has landed and the button is free.
    if (state !== 'done' || reads.pending !== 0) return
    reset()
  }, [state, reads.pending, reset])
  const send = () => {
    if (core === null || reads.position === null) return
    const start = pageStart(reads.position)
    void tx.send({ account, address: core, abi: coreAbi, functionName: 'settle', args: [targetId as Hex, start, SETTLE_PAGE] })
  }
  // A read that fails is a failure of the row, not a row without a button.
  if (reads.failed) return <ErrorState what={copy.activity.claimFailed} onChainSafe onRetry={reads.retry} />
  if (reads.loading) return <Skeleton label={copy.common.loading} />
  if (reads.position === null || reads.pending === 0) return null
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

/** What the chain says about the settlement of one target. */
type SettleReads = {
  /** The index of the vote of the account, when the chain said. */
  position: number | null
  /** How many attestations of the target still wait to be settled. */
  pending: number | null
  /** The chain could not be read. */
  failed: boolean
  /** The chain has not answered yet. */
  loading: boolean
  /** Reads the two numbers again. */
  retry: () => void
  /** Reads the number of attestations that wait again. */
  refetchPending: () => void
}

/** The two reads the claim needs, and the state they are in. */
function useSettleReads(targetId: string, account: Address): SettleReads {
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
  const readIndex = useRef(index.refetch)
  readIndex.current = index.refetch
  const readPending = useRef(pending.refetch)
  readPending.current = pending.refetch
  const retry = useCallback(() => {
    void readIndex.current()
    void readPending.current()
  }, [])
  const refetchPending = useCallback(() => void readPending.current(), [])
  return {
    position: indexOf(index.data),
    pending: pendingCount(pending.data),
    failed: index.isError === true || pending.isError === true,
    loading: index.isLoading === true || pending.isLoading === true,
    retry,
    refetchPending,
  }
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
