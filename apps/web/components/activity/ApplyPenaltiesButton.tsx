'use client'
import { useEffect, useRef } from 'react'
import type { Address, Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { coreAddress } from '../../lib/chain/addresses'
import { modulesLive } from '../../lib/chain/config'
import { useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { ErrorState } from '../ui/ErrorState'
import { ActionButton } from './ActionButton'
import { usePenaltyRange, type PenaltyRange } from '../../lib/activity/usePenaltyRange'

export type ApplyPenaltiesButtonProps = {
  account: Address
  targetId: string
  /** The penalties that are still waiting on this target, as the chain counts them. */
  pending: number
  /** How many attestations the target holds, when the chain said. */
  attestations: number | null
  /** The moment the number of pending penalties was read from the chain. */
  updatedAt: number
  /** The number of pending penalties could not be read. */
  failed: boolean
  /** The target could not be read, so the range of a page is unknown. */
  viewsFailed: boolean
  /**
   * Called once a page of penalties was mined, with the number that was waiting before the page.
   *
   * The number is the one the screen showed before the page, so the reader can be told what the
   * page did once the chain has answered again.
   */
  onApplied: (before: number) => void
  /** Called when the reader asks for the chain to answer again. */
  onRetry: () => void
  /** The one button of the view that carries the accent. */
  primary?: boolean
}

/**
 * The button that applies the penalties of a confirmed danger.
 *
 * The contract takes a range of attestations, so the penalties are applied one page at a time.
 * Every page is a transaction of its own, and the number that is left is read from the chain
 * again after every page, because the chain alone knows how many penalties a page held. A page
 * starts where the chain says there is still a safe vote to charge, and it never reaches past the
 * last attestation of the target, so a page never costs gas for a range that holds nothing. A page
 * may hold no penalty at all: the contract only charges the SAFE votes, and it does not say where
 * they are. The reader is told what the last page did, and the reader is told only after the chain
 * has answered, so the number is never a guess and never the number of a page that was never sent.
 */
export function ApplyPenaltiesButton(props: ApplyPenaltiesButtonProps) {
  const { account, targetId, pending, primary = false } = props
  const tx = useWriteTx()
  const core = coreAddress()
  const range = usePenaltyRange(targetId, props.attestations)
  const page = usePenaltyPage({ ...props, tx, range })
  return (
    <div className="sf-stack">
      <PenaltyAction {...props} tx={tx} core={core} range={range} primary={primary} onSubmit={page.send} />
      {range.covered ? (
        <p className="sf-lead">{copy.activity.penaltiesCovered}</p>
      ) : (
        <p className="sf-lead">
          {pending === 1
            ? copy.activity.penaltiesRemainOne
            : copy.activity.penaltiesRemain.replace('{count}', String(pending))}
        </p>
      )}
      {!modulesLive && <p className="sf-lead">{copy.common.modulesNotLive}</p>}
      <p className="sf-lead">{copy.activity.penaltiesGas}</p>
    </div>
  )
}

/** The action of the row: a page of penalties, or the reason there is none. */
function PenaltyAction({
  tx,
  core,
  range,
  viewsFailed,
  onRetry,
  primary,
  onSubmit,
}: ApplyPenaltiesButtonProps & {
  tx: ReturnType<typeof useWriteTx>
  core: Address | null
  range: PenaltyRange
  onSubmit: () => void
}) {
  // A target that cannot be read leaves the range of a page unknown.
  if (viewsFailed) return <ErrorState what={copy.activity.penaltiesFailed} onChainSafe onRetry={onRetry} />
  if (range.failed) return <ErrorState what={copy.activity.penaltiesFailed} onChainSafe onRetry={onRetry} />
  if (range.covered) return null
  // The chain has not said where the page starts yet, so no page is sent.
  if (range.start === null) return <p className="sf-lead">{copy.common.loading}</p>
  return (
    <ActionButton
      label={copy.activity.penaltiesAction}
      state={tx.state}
      error={tx.error}
      txHash={tx.txHash}
      disabled={core === null || !modulesLive}
      primary={primary}
      onSubmit={onSubmit}
    />
  )
}

/** The page of penalties that comes next. */
function usePenaltyPage({
  tx,
  account,
  targetId,
  pending,
  updatedAt,
  failed,
  onApplied,
  range,
}: ApplyPenaltiesButtonProps & { tx: ReturnType<typeof useWriteTx>; range: PenaltyRange }) {
  const core = coreAddress()
  usePenaltyReset({
    state: tx.state,
    txHash: tx.txHash,
    reset: tx.reset,
    pending,
    updatedAt,
    failed,
    onApplied,
    onMined: range.refetch,
  })
  const send = () => {
    if (core === null || range.start === null || range.size === 0) return
    void tx.send({
      account,
      address: core,
      abi: coreAbi,
      functionName: 'applyPenalties',
      args: [targetId as Hex, range.start, range.size],
    })
  }
  return { send }
}

/**
 * The button frees itself once the chain has answered again.
 *
 * The page that was mined leaves the chain to answer what is left, and the button waits for that
 * answer before it is free again. The number that is left is read by the page, so a page that
 * clears its target does not take the report of the page with it.
 */
function usePenaltyReset({
  state,
  txHash,
  reset,
  pending,
  updatedAt,
  failed,
  onApplied,
  onMined,
}: {
  state: string
  txHash: string | null
  reset: () => void
  pending: number
  updatedAt: number
  failed: boolean
  onApplied: (before: number) => void
  onMined: () => void
}) {
  const mined = useRef<string | null>(null)
  /** The read the page was waiting for, so the button knows when the chain answered. */
  const waiting = useRef<{ readAt: number } | null>(null)
  useEffect(() => {
    if (state !== 'done' || txHash === null || mined.current === txHash) return
    mined.current = txHash
    // The range of the next page is read again, so it starts where the chain says.
    onMined()
    // The page was mined. The number that was waiting before the page is the one the page is
    // measured against, and the rest is read again before anything is said about it.
    waiting.current = { readAt: updatedAt }
    onApplied(pending)
  }, [state, txHash, pending, updatedAt, onApplied, onMined])
  useEffect(() => {
    if (waiting.current === null || updatedAt === waiting.current.readAt) return
    // The chain has answered again, so the button is free for the next page.
    waiting.current = null
    reset()
  }, [updatedAt, reset])
  useEffect(() => {
    if (waiting.current === null || !failed) return
    // The chain could not be read, so the button is free and nothing is said about the page.
    waiting.current = null
    reset()
  }, [failed, reset])
}
