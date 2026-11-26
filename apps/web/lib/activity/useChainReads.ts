'use client'
import { useCallback, useMemo, useRef } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { zeroAddress, type Address, type Hex } from 'viem'
import { coreAbi, vaultAbi } from '@sealflare/shared/abi'
import { coreAddress, vaultAddress } from '../chain/addresses'
import { expectedChainId } from '../chain/config'
import { toNextWeight } from './standing'

/**
 * The readings of the chain that the My activity screen shows.
 *
 * The balance, the standing and the pending penalties are read from the contracts and not from
 * the indexer, so a reader never sees a number that the chain has already changed. A read that
 * fails is a failure of the screen, not an empty reading: the screen says so.
 */

/** The balance of an account in the vault, in wei. Null while it is not read. */
export function useVaultBalance(address: string | null): {
  wei: bigint | null
  failed: boolean
  refetch: () => void
} {
  const vault = vaultAddress()
  const read = useReadContract({
    abi: vaultAbi,
    address: vault ?? undefined,
    chainId: expectedChainId,
    functionName: 'balanceOf',
    args: [(address ?? zeroAddress) as Address],
    query: { enabled: vault !== null && address !== null },
  })
  const data = read.data
  const refetch = useStableRefetch(read)
  return {
    wei: typeof data === 'bigint' ? data : null,
    failed: read.isError === true,
    refetch,
  }
}

/** A refetch that keeps its name, so the panels are not drawn again for nothing. */
function useStableRefetch(read: { refetch: () => unknown }): () => void {
  const latest = useRef(read.refetch)
  latest.current = read.refetch
  return useCallback(() => void latest.current(), [])
}

/** The standing of an account: its score, its weight and what it may still attest today. */
export type StandingReading = {
  score: number | null
  weight: number | null
  toNextWeight: number | null
  attestationsLeft: number | null
  failed: boolean
  refetch: () => void
}

export function useStanding(address: string | null): StandingReading {
  const core = coreAddress()
  const enabled = core !== null && address !== null
  const guardian = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'getGuardian',
    args: [(address ?? zeroAddress) as Address],
    query: { enabled },
  })
  const weight = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'weightOf',
    args: [(address ?? zeroAddress) as Address],
    query: { enabled },
  })
  const quota = useReadContract({
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    functionName: 'attestationsLeftToday',
    args: [(address ?? zeroAddress) as Address],
    query: { enabled },
  })
  const score = scoreOf(guardian.data)
  const failed = guardian.isError === true || weight.isError === true || quota.isError === true
  const readGuardian = useStableRefetch(guardian)
  const readWeight = useStableRefetch(weight)
  const readQuota = useStableRefetch(quota)
  const refetch = useCallback(() => {
    readGuardian()
    readWeight()
    readQuota()
  }, [readGuardian, readWeight, readQuota])
  return {
    score,
    weight: typeof weight.data === 'number' ? weight.data : null,
    toNextWeight: score === null ? null : toNextWeight(score),
    attestationsLeft: typeof quota.data === 'number' ? quota.data : null,
    failed,
    refetch,
  }
}

/** The score of a guardian, when the chain answered with one. */
function scoreOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const score = (data as { score?: unknown }).score
  return typeof score === 'number' ? score : null
}

/** What the chain says about the penalties of one target. */
export type TargetPenalties = {
  /** The SAFE votes that would still be charged. */
  pending: number
  /** How many attestations the target holds, when the chain said. */
  attestations: number | null
}

/** The penalties that are still waiting on each of the targets. */
export function usePendingPenalties(targets: readonly string[]): {
  pending: Record<string, TargetPenalties>
  failed: boolean
  refetch: () => void
} {
  const core = coreAddress()
  const key = targets.join(',')
  const contracts = useMemo(
    () =>
      core === null
        ? []
        : targets.flatMap(target => [
            {
              abi: coreAbi,
              address: core,
              functionName: 'pendingPenalties' as const,
              args: [target as Hex],
            },
            {
              abi: coreAbi,
              address: core,
              functionName: 'getTarget' as const,
              args: [target as Hex],
            },
          ]),
    // The contracts are rebuilt only when the targets change, so the read is not repeated.
    [key, core],
  )
  const read = useReadContracts({
    contracts,
    chainId: expectedChainId,
    query: { enabled: core !== null && targets.length > 0 },
  })
  const pending: Record<string, TargetPenalties> = {}
  targets.forEach((target, index) => {
    const count = read.data?.[index * 2]
    const view = read.data?.[index * 2 + 1]
    pending[target] = {
      pending: typeof count === 'number' ? count : 0,
      attestations: attestationCountOf(view),
    }
  })
  const refetch = useStableRefetch(read)
  return { pending, failed: read.isError === true, refetch }
}

/** How many attestations a target holds, when the chain answered with the target. */
function attestationCountOf(view: unknown): number | null {
  if (typeof view !== 'object' || view === null) return null
  const count = (view as { attestationCount?: unknown }).attestationCount
  return typeof count === 'number' ? count : null
}
