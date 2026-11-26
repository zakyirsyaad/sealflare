'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SignalGroup } from '@sealflare/shared/schemas'
import type { Verdict } from '@sealflare/shared/rules'

/** A vote that is on the chain but not yet read by the indexer. */
export type PendingVote = {
  verdict: Verdict
  txHash: string
  /** The account that cast the vote. Another account of the same wallet did not vote. */
  guardian: string
  /** The votes of this verdict that the page showed before the vote was cast. */
  baseline: number
}

export type Signal = { newIds: SignalGroup; guardians: SignalGroup }

type PendingVoteValue = {
  vote: PendingVote | null
  register: (verdict: Verdict, txHash: string, guardian: string) => void
}

const Context = createContext<PendingVoteValue>({ vote: null, register: () => {} })

/** The votes of one verdict, counted in both groups. */
export function countVerdict(signal: Signal, verdict: Verdict): number {
  const key = verdict.toLowerCase() as 'safe' | 'caution' | 'danger'
  return signal.newIds.votes[key] + signal.guardians.votes[key]
}

/** Asks the server for the page again, once, when the vote of this session lands. */
function RefreshOnce() {
  const router = useRouter()
  useEffect(() => {
    router.refresh()
    // The router object changes between renders, and the page must be asked for only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * The vote of this session, until the page reads it from the chain.
 *
 * The panel registers the vote as soon as the receipt is good. The breakdown shows it with the
 * label "Waiting for finality" until the server data holds it too.
 */
export function PendingVoteProvider({ signal, children }: { signal: Signal; children: React.ReactNode }) {
  const [vote, setVote] = useState<PendingVote | null>(null)
  // The signal of the first render is the state before the vote. A later refresh must not move it.
  const before = useRef(signal)
  const register = useCallback((verdict: Verdict, txHash: string, guardian: string) => {
    setVote({ verdict, txHash, guardian, baseline: countVerdict(before.current, verdict) })
  }, [])
  const value = useMemo(() => ({ vote, register }), [vote, register])
  return (
    <Context.Provider value={value}>
      {children}
      {vote !== null && <RefreshOnce />}
    </Context.Provider>
  )
}

/** The vote of this session and the way to register one. */
export function usePendingVote(): PendingVoteValue {
  return useContext(Context)
}
