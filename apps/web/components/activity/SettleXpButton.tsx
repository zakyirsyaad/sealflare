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
 * reputation of that vote is always inside the range. The chain decides whether there is anything
 * to claim: the vote of the account, its own state, and what the target still holds. A vote that
 * is settled already, or a target that holds nothing to settle, says so in words instead of
 * offering a call that would cost gas for nothing. The result of a claim stays on the screen until
 * the indexer reads it.
 */
export function SettleXpButton({ account, targetId, primary = false, onSettled }: SettleXpButtonProps) {
  const tx = useWriteTx()
  const core = coreAddress()
  const reads = useSettleReads(targetId, account)
  const mined = useRef<string | null>(null)
  useEffect(() => {
    if (tx.state !== 'done' || tx.txHash === null || mined.current === tx.txHash) return
    mined.current = tx.txHash
    onSettled?.()
    reads.refetch()
  }, [tx.state, tx.txHash, onSettled, reads.refetch])
  const send = () => {
    if (core === null || reads.position === null) return
    const start = pageStart(reads.position)
    void tx.send({ account, address: core, abi: coreAbi, functionName: 'settle', args: [targetId as Hex, start, SETTLE_PAGE] })
  }
  // The claim landed, so the result stays on the screen until the indexer reads it.
  if (tx.state === 'done') return <ClaimControl tx={tx} core={core} primary={primary} onSubmit={send} />
  // A read that fails is a failure of the row, not a row without a button.
  if (reads.failed) return <ErrorState what={copy.activity.claimFailed} onChainSafe onRetry={reads.retry} />
  if (reads.loading) return <Skeleton label={copy.common.loading} />
  // The chain does not hold a vote of the account on this target.
  if (reads.position === null) return <p className="sf-lead">{copy.activity.claimNoVote}</p>
  // The vote of the account is settled already, so a claim would cost gas for nothing.
  if (reads.settled === true) return <p className="sf-lead">{copy.activity.claimSettled}</p>
  // The target holds nothing that can be settled.
  if (reads.pending === 0) return <p className="sf-lead">{copy.activity.claimEmpty}</p>
  return <ClaimControl tx={tx} core={core} primary={primary} onSubmit={send} />
}

/** The button of the claim, with the note that settling costs gas. */
function ClaimControl({
  tx,
  core,
  primary,
  onSubmit,
}: {
  tx: ReturnType<typeof useWriteTx>
  core: Address | null
  primary: boolean
  onSubmit: () => void
}) {
  return (
    <div className="sf-stack">
      <ActionButton
        label={copy.activity.claimAction}
        state={tx.state}
        error={tx.error}
        txHash={tx.txHash}
        disabled={core === null}
        primary={primary}
        onSubmit={onSubmit}
      />
      <p className="sf-lead">{copy.activity.settleGas}</p>
    </div>
  )
}

/** What the chain says about the settlement of one target. */
type SettleReads = {
  /** The index of the vote of the account, when the chain said. */
  position: number | null
  /** Whether the vote of the account is settled already. */
  settled: boolean | null
  /** How many attestations of the target still wait to be settled. */
  pending: number | null
  /** The chain could not be read. */
  failed: boolean
  /** The chain has not answered yet. */
  loading: boolean
  /** Reads the three numbers again. */
  retry: () => void
  /** Reads the three numbers again. */
  refetch: () => void
}

/** The three reads the claim needs, and the state they are in. */
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
  const position = indexOf(index.data)
  const attestation = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'getAttestation',
    args: [targetId as Hex, position ?? 0],
    query: { enabled: enabled && position !== null },
  })
  const pending = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'pendingSettlement',
    args: [targetId as Hex],
    query: { enabled },
  })
  const refetch = useRefetchOf([index, attestation, pending])
  return {
    position,
    settled: settledOf(attestation.data),
    pending: pendingCount(pending.data),
    failed:
      core === null ||
      index.isError === true ||
      attestation.isError === true ||
      pending.isError === true,
    loading:
      index.isLoading === true ||
      pending.isLoading === true ||
      (position !== null && attestation.isLoading === true),
    retry: refetch,
    refetch,
  }
}

/** A refetch of several reads, with a name that does not change from render to render. */
function useRefetchOf(reads: { refetch: () => unknown }[]): () => void {
  const latest = useRef(reads)
  latest.current = reads
  return useCallback(() => {
    for (const read of latest.current) void read.refetch()
  }, [])
}

/** The index of the vote of the account, when the chain answered with one. */
function indexOf(data: unknown): number | null {
  if (!Array.isArray(data)) return null
  const [attested, index] = data as [unknown, unknown]
  if (attested !== true || typeof index !== 'number') return null
  return index
}

/** Whether the vote of the account is settled, when the chain answered with it. */
function settledOf(data: unknown): boolean | null {
  if (typeof data !== 'object' || data === null) return null
  const settled = (data as { settled?: unknown }).settled
  return typeof settled === 'boolean' ? settled : null
}

/** How many attestations of the target are still waiting to be settled. */
function pendingCount(data: unknown): number | null {
  return typeof data === 'number' ? data : null
}

/** The first attestation of the page that holds the vote. */
export function pageStart(index: number): number {
  return Math.floor(index / SETTLE_PAGE) * SETTLE_PAGE
}
