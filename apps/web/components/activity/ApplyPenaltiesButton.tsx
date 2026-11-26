'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { coreAddress } from '../../lib/chain/addresses'
import { modulesLive } from '../../lib/chain/config'
import { useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { ActionButton } from './ActionButton'

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
  /** Called once a page of penalties was applied, so the rest is read again. */
  onApplied: () => void
  /** The one button of the view that carries the accent. */
  primary?: boolean
}

/** How many attestations one call of applyPenalties covers. */
export const PENALTY_CHUNK = 50

/**
 * The button that applies the penalties of a confirmed danger.
 *
 * The contract takes a range of attestations, so the penalties are applied one page at a time.
 * Every page is a transaction of its own, and the number that is left is read from the chain
 * again after every page, because the chain alone knows how many penalties a page held. A page
 * never reaches past the last attestation of the target, but a page may hold no penalty at all:
 * the contract only charges the SAFE votes, and it does not say where they are. The reader is
 * told what the last page did, and the reader is told only after the chain has answered, so the
 * number is never a guess and never the number of a page that was never sent.
 */
export function ApplyPenaltiesButton(props: ApplyPenaltiesButtonProps) {
  const { account, targetId, pending, primary = false } = props
  const tx = useWriteTx()
  const core = coreAddress()
  const page = usePenaltyPage({ ...props, tx })
  return (
    <div className="sf-stack">
      {!page.covered && (
        <ActionButton
          label={copy.activity.penaltiesAction}
          state={tx.state}
          error={tx.error}
          txHash={tx.txHash}
          disabled={core === null || !modulesLive}
          primary={primary}
          onSubmit={page.send}
        />
      )}
      {page.covered
        ? <p className="sf-lead">{copy.activity.penaltiesCovered}</p>
        : <p className="sf-lead">{copy.activity.penaltiesRemain.replace('{count}', String(pending))}</p>}
      {page.applied !== null && (
        <p className="sf-lead">
          {page.applied === 0
            ? copy.activity.penaltiesNone
            : copy.activity.penaltiesApplied.replace('{count}', String(page.applied))}
        </p>
      )}
      <p className="sf-lead">{copy.activity.penaltiesGas}</p>
    </div>
  )
}

/** The page of penalties that comes next, and what the last page did. */
function usePenaltyPage({
  tx,
  account,
  targetId,
  pending,
  attestations,
  updatedAt,
  failed,
  onApplied,
}: ApplyPenaltiesButtonProps & { tx: ReturnType<typeof useWriteTx> }) {
  const core = coreAddress()
  const [start, setStart] = useState(0)
  const used = useRef(PENALTY_CHUNK)
  const onMined = useCallback(() => setStart(value => value + used.current), [])
  const applied = useAppliedReport({
    state: tx.state,
    txHash: tx.txHash,
    reset: tx.reset,
    pending,
    updatedAt,
    failed,
    onApplied,
    onMined,
  })
  const left = attestations === null ? null : Math.max(0, attestations - start)
  const size = left === null ? PENALTY_CHUNK : Math.min(PENALTY_CHUNK, left)
  const covered = left !== null && left === 0
  const send = () => {
    if (core === null || covered) return
    used.current = size
    void tx.send({ account, address: core, abi: coreAbi, functionName: 'applyPenalties', args: [targetId as Hex, start, size] })
  }
  return { applied, size, covered, send }
}

/** The number of penalties the last page applied, told only after the chain has answered. */
function useAppliedReport({
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
  onApplied: () => void
  onMined: () => void
}) {
  const [applied, setApplied] = useState<number | null>(null)
  const mined = useRef<string | null>(null)
  /** The number that was waiting before the page, and the read it came from. */
  const waiting = useRef<{ before: number; readAt: number } | null>(null)
  useEffect(() => {
    if (state !== 'done' || txHash === null || mined.current === txHash) return
    mined.current = txHash
    onMined()
    // The page was mined. The number that is left is read again before anything is reported.
    waiting.current = { before: pending, readAt: updatedAt }
    onApplied()
  }, [state, txHash, pending, updatedAt, onApplied, onMined])
  useEffect(() => {
    if (waiting.current === null || updatedAt === waiting.current.readAt) return
    // The chain has answered with the number that is left, so the page is known to have done its work.
    const before = waiting.current.before
    waiting.current = null
    setApplied(before - pending)
    reset()
  }, [updatedAt, pending, reset])
  useEffect(() => {
    if (waiting.current === null || !failed) return
    // The chain could not be read, so nothing is said about what the page did.
    waiting.current = null
    reset()
  }, [failed, reset])
  return applied
}
