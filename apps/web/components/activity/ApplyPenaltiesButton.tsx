'use client'
import { useEffect, useRef, useState } from 'react'
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
 * told what the last page did, so a page that changed nothing is never a surprise.
 */
export function ApplyPenaltiesButton({
  account,
  targetId,
  pending,
  attestations,
  onApplied,
  primary = false,
}: ApplyPenaltiesButtonProps) {
  const tx = useWriteTx()
  const core = coreAddress()
  const [start, setStart] = useState(0)
  const [applied, setApplied] = useState<number | null>(null)
  const mined = useRef<string | null>(null)
  const used = useRef(PENALTY_CHUNK)
  const before = useRef<number | null>(null)
  const { state, txHash, reset } = tx
  useEffect(() => {
    if (state !== 'done' || txHash === null || mined.current === txHash) return
    mined.current = txHash
    setStart(value => value + used.current)
    // The number that is left is read from the chain, so the next page may start right away.
    reset()
    onApplied()
  }, [state, txHash, reset, onApplied])
  useEffect(() => {
    // The chain has read the number that is left, so the page is known to have done its work.
    if (state !== 'idle' || before.current === null) return
    setApplied(before.current - pending)
    before.current = null
  }, [pending, state])
  const left = attestations === null ? null : Math.max(0, attestations - start)
  const size = left === null ? PENALTY_CHUNK : Math.min(PENALTY_CHUNK, left)
  const covered = left !== null && left === 0
  const send = () => {
    if (core === null || covered) return
    used.current = size
    before.current = pending
    void tx.send({ account, address: core, abi: coreAbi, functionName: 'applyPenalties', args: [targetId as Hex, start, size] })
  }
  return (
    <div className="sf-stack">
      {!covered && (
        <ActionButton
          label={copy.activity.penaltiesAction}
          state={tx.state}
          error={tx.error}
          txHash={tx.txHash}
          disabled={core === null || !modulesLive}
          primary={primary}
          onSubmit={send}
        />
      )}
      {covered
        ? <p className="sf-lead">{copy.activity.penaltiesCovered}</p>
        : <p className="sf-lead">{copy.activity.penaltiesRemain.replace('{count}', String(pending))}</p>}
      {applied !== null && (
        <p className="sf-lead">
          {applied === 0
            ? copy.activity.penaltiesNone
            : copy.activity.penaltiesApplied.replace('{count}', String(applied))}
        </p>
      )}
      <p className="sf-lead">{copy.activity.penaltiesGas}</p>
    </div>
  )
}
