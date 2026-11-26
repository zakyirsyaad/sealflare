'use client'
import { useReadContract } from 'wagmi'
import { courtAbi } from '@sealflare/shared/abi'
import { expectedChainId } from '../../lib/chain/config'
import {
  courtAddress,
  outcomeFromChain,
  phaseFromChain,
  type ChallengeOutcome,
  type ChallengePhase,
} from '../../lib/chain/court'

/** What the Court says about one dispute right now. Null means the chain has not answered. */
export type ChallengeChain = {
  phase: ChallengePhase | null
  commits: number | null
  reveals: number | null
  outcome: ChallengeOutcome | null
}

const REFRESH_MS = 15_000

const count = (value: unknown): number | null => (typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : null)

/**
 * The phase and the counts of a dispute, read from the Court.
 *
 * The phase comes from `Court.phaseOf`, the same function the contract checks, and never from the
 * clock of the browser. The read is repeated, so the page follows the dispute from phase to phase.
 */
export function useChallengeChain(challengeId: string): ChallengeChain {
  const court = courtAddress()
  const base = {
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    args: [BigInt(challengeId)] as const,
    query: { enabled: court !== null, refetchInterval: REFRESH_MS },
  }
  const phase = useReadContract({ ...base, functionName: 'phaseOf' })
  const challenge = useReadContract({ ...base, functionName: 'getChallenge' })
  const data = (challenge.data ?? {}) as { commits?: unknown; reveals?: unknown; outcome?: unknown }
  return {
    phase: phaseFromChain(phase.data),
    commits: count(data.commits),
    reveals: count(data.reveals),
    outcome: outcomeFromChain(data.outcome),
  }
}
