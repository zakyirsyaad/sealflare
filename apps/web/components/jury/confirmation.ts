'use client'
import { useEffect, useState } from 'react'
import type { TxState } from '../../lib/chain/useWriteTx'
import { buttonStateOf } from '../dispute/txButtonState'
import type { AttestState } from '../attest/useAttest'
import type { JurorState } from './useJuror'

/** Where the check of the chain stands after a transaction. Null until the transaction is done. */
export type Outcome = 'checking' | 'confirmed' | 'missing' | null

/**
 * Asks the Court what it holds once a transaction is done, and says whether it holds what was sent.
 *
 * A wallet that cancels or replaces a transaction can still hand back a successful receipt, the one
 * of the replacement. Only the Court knows whether the commit or the reveal is really there, so
 * nothing is shown as committed or revealed before it says so.
 */
export function useConfirmation(
  txState: TxState,
  refetch: () => Promise<JurorState | null>,
  holds: (juror: JurorState | null) => boolean,
): Outcome {
  const [outcome, setOutcome] = useState<Outcome>(null)
  useEffect(() => {
    if (txState !== 'done') {
      setOutcome(null)
      return
    }
    let live = true
    setOutcome('checking')
    void refetch().then(juror => {
      if (live) setOutcome(holds(juror) ? 'confirmed' : 'missing')
    })
    return () => {
      live = false
    }
    // The check runs once per finished transaction. A new `refetch` or `holds` must not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txState])
  return outcome
}

export type ConfirmedView = { state: AttestState; error: string | null; checking: boolean }

/**
 * Whether the chain already holds what the juror tried to do, asked once a transaction failed.
 *
 * A commit that the Court refuses because the juror committed before is not a failure to retry:
 * the vote is in, and every retry would be refused the same way. The Court is asked, and when it
 * holds the commit the panel says so instead of offering a retry.
 */
export function useHeldByChain(
  txState: TxState,
  refetch: () => Promise<JurorState | null>,
  held: (juror: JurorState | null) => boolean,
): boolean {
  const [isHeld, setIsHeld] = useState(false)
  useEffect(() => {
    if (txState !== 'failed') {
      setIsHeld(false)
      return
    }
    let live = true
    void refetch().then(juror => {
      if (live) setIsHeld(held(juror))
    })
    return () => {
      live = false
    }
    // The check runs once per failed transaction. A new `refetch` or `held` must not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txState])
  return isHeld
}

/** The state a button shows: a finished transaction waits for the Court, and fails if the Court does not hold it. */
export function confirmedView(tx: { state: TxState; error: string | null }, outcome: Outcome, missing: string): ConfirmedView {
  if (tx.state !== 'done') return { state: buttonStateOf(tx.state), error: tx.error, checking: false }
  if (outcome === 'confirmed') return { state: 'done', error: null, checking: false }
  if (outcome === 'missing') return { state: 'failed', error: missing, checking: false }
  return { state: 'pending', error: null, checking: true }
}
