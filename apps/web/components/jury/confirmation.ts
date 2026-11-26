'use client'
import { useEffect, useState } from 'react'
import type { TxState } from '../../lib/chain/useWriteTx'
import { buttonStateOf } from '../dispute/txButtonState'
import type { AttestState } from '../attest/useAttest'
import type { JurorChain, JurorState } from './useJuror'

/** Where the check of the chain stands after a transaction. Null until the transaction is done. */
export type Outcome = 'checking' | 'confirmed' | 'missing' | null

/** How often the Court is asked again while the answer is not known. */
const ASK_MS = 1_000
/**
 * How many times the Court is asked before the panel believes that the vote is not there.
 *
 * The asking takes about nine seconds, which is long enough for a node that is a few blocks behind
 * to catch up. A miss is never believed before the asking is over, so a lagging node never offers a
 * retry that the Court would refuse, and the gas of it would be lost.
 */
const MAX_ASKS = 10

/** What the asking of the Court came to. */
type Answers = {
  /** The last answer of the Court that worked. */
  read: JurorState | null
  /** How many answers that worked did not hold what was sent. */
  misses: number
  /** True when the asking is over and the Court never held what was sent. */
  over: boolean
}

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
  refetch: () => Promise<{ juror: JurorState | null; failed: boolean }>,
  holds: (juror: JurorState | null) => boolean,
): Answers {
  const [read, setRead] = useState<JurorState | null>(null)
  const [misses, setMisses] = useState(0)
  const [over, setOver] = useState(false)
  useEffect(() => {
    if (!active) {
      setRead(null)
      setMisses(0)
      setOver(false)
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
        // The asking stops when the Court holds what was sent.
        if (found) return
        if (asks < MAX_ASKS) {
          timer = setTimeout(ask, ASK_MS)
          return
        }
        // The asking is over, so the panel may believe that the vote is not there.
        setOver(true)
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
  return { read, misses, over }
}

/**
 * Says whether the chain holds what was sent, once a transaction is done.
 *
 * A wallet that cancels or replaces a transaction can still hand back a successful receipt, the one
 * of the replacement. Only the Court knows whether the commit or the reveal is really there, so
 * nothing is shown as committed or revealed before it says so.
 *
 * The Court is asked again and again, because a node that lags says nothing at all. The miss is
 * only believed when the asking is over, so a lagging node never sends a retry that the Court would
 * refuse. The polled state of the Court counts too, so a commit that shows up later turns the miss
 * into the confirmation, and a read that says nothing turns the miss into the answer of the poll.
 */
export function useConfirmation(
  txState: TxState,
  chain: JurorChain,
  holds: (juror: JurorState | null) => boolean,
): Outcome {
  const { read, misses, over } = useCourtAnswers(txState === 'done', chain.refetch, holds)
  if (txState !== 'done') return null
  if (holds(read) || holds(chain.juror)) return 'confirmed'
  // The Court was asked again and again and does not hold what was sent, so the vote is not there.
  if (over && misses > 0) return 'missing'
  // Every read failed and the asking is over, so the polled state of the Court is the last word.
  if (over && chain.juror !== null && !chain.failed) return 'missing'
  return 'checking'
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
  chain: JurorChain,
  held: (juror: JurorState | null) => boolean,
): JurorState | null {
  const { read } = useCourtAnswers(txState === 'failed', chain.refetch, held)
  return txState === 'failed' && held(read) ? read : null
}

/** The state a button shows: a finished transaction waits for the Court, and fails if the Court does not hold it. */
export function confirmedView(tx: { state: TxState; error: string | null }, outcome: Outcome, missing: string): ConfirmedView {
  if (tx.state !== 'done') return { state: buttonStateOf(tx.state), error: tx.error, checking: false }
  if (outcome === 'confirmed') return { state: 'done', error: null, checking: false }
  if (outcome === 'missing') return { state: 'failed', error: missing, checking: false }
  return { state: 'pending', error: null, checking: true }
}
