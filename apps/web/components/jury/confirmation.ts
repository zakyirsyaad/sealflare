'use client'
import { useEffect, useState } from 'react'
import type { TxState } from '../../lib/chain/useWriteTx'
import { buttonStateOf } from '../dispute/txButtonState'
import type { AttestState } from '../attest/useAttest'
import type { JurorRead, JurorState } from './useJuror'

/** Where the check of the chain stands after a transaction. Null until the transaction is done. */
export type Outcome = 'checking' | 'confirmed' | 'missing' | null

/** How often the Court is asked again, and how many reads a miss takes before it is believed. */
const ASK_MS = 1_000
const MISSING_AFTER = 3
/** How many times the Court is asked before the panel stops asking on its own. */
const MAX_ASKS = 20

/**
 * Asks the Court what it holds, again while the answer is not known.
 *
 * A node that is a block behind, or a read that failed, says nothing about the vote. So the Court is
 * asked again every second, a read that failed is not a miss, and the last answer that worked is
 * what the panel shows. The asking stops on its own after a while, and the polled state of the
 * Court takes over from there.
 */
function useCourtAnswers(
  active: boolean,
  refetch: () => Promise<JurorRead>,
  holds: (juror: JurorState | null) => boolean,
): { read: JurorState | null; misses: number } {
  const [read, setRead] = useState<JurorState | null>(null)
  const [misses, setMisses] = useState(0)
  useEffect(() => {
    if (!active) {
      setRead(null)
      setMisses(0)
      return
    }
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let asks = 0
    const ask = () => {
      void refetch().then(result => {
        if (!live) return
        // A read that failed says nothing, so the last answer that worked is kept.
        const found = !result.failed && holds(result.juror)
        if (!result.failed) {
          setRead(result.juror)
          setMisses(count => (found ? 0 : count + 1))
        }
        asks += 1
        // The asking stops when the Court holds what was sent, and after a while anyway.
        if (asks < MAX_ASKS && !found) timer = setTimeout(ask, ASK_MS)
      })
    }
    ask()
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
    // The asking starts once per transaction. A new `refetch` or `holds` must not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  return { read, misses }
}

/**
 * Says whether the chain holds what was sent, once a transaction is done.
 *
 * A wallet that cancels or replaces a transaction can still hand back a successful receipt, the one
 * of the replacement. Only the Court knows whether the commit or the reveal is really there, so
 * nothing is shown as committed or revealed before it says so.
 *
 * The answer is read again and again, because a node that lags says nothing at all. The polled
 * state of the Court counts too, so a commit that shows up later turns the miss into the
 * confirmation.
 */
export function useConfirmation(
  txState: TxState,
  refetch: () => Promise<JurorRead>,
  polled: JurorState | null,
  holds: (juror: JurorState | null) => boolean,
): Outcome {
  const { read, misses } = useCourtAnswers(txState === 'done', refetch, holds)
  if (txState !== 'done') return null
  if (holds(read) || holds(polled)) return 'confirmed'
  return misses >= MISSING_AFTER ? 'missing' : 'checking'
}

export type ConfirmedView = { state: AttestState; error: string | null; checking: boolean }

/**
 * The commit the Court holds for this wallet, asked once a transaction failed.
 *
 * A commit that the Court refuses because the juror committed before is not a failure to retry:
 * the vote is in, and every retry would be refused the same way. The Court is asked, and what it
 * holds is given back, so the panel can tell whether the code of this panel is the committed one.
 */
export function useHeldByChain(
  txState: TxState,
  refetch: () => Promise<JurorRead>,
  held: (juror: JurorState | null) => boolean,
): JurorState | null {
  const { read } = useCourtAnswers(txState === 'failed', refetch, held)
  return txState === 'failed' && held(read) ? read : null
}

/** The state a button shows: a finished transaction waits for the Court, and fails if the Court does not hold it. */
export function confirmedView(tx: { state: TxState; error: string | null }, outcome: Outcome, missing: string): ConfirmedView {
  if (tx.state !== 'done') return { state: buttonStateOf(tx.state), error: tx.error, checking: false }
  if (outcome === 'confirmed') return { state: 'done', error: null, checking: false }
  if (outcome === 'missing') return { state: 'failed', error: missing, checking: false }
  return { state: 'pending', error: null, checking: true }
}
