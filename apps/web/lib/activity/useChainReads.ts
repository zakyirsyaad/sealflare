'use client'
import { useMemo } from 'react'
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
 * the indexer, so a reader never sees a number that the chain has already changed.
 */

/** The balance of an account in the vault, in wei. Null while it is not read. */
export function useVaultBalance(address: string | null): { wei: bigint | null; refetch: () => void } {
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
  return { wei: typeof data === 'bigint' ? data : null, refetch: () => void read.refetch() }
}

/** The standing of an account: its score, its weight and what it may still attest today. */
export type StandingReading = {
  score: number | null
  weight: number | null
  toNextWeight: number | null
  attestationsLeft: number | null
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
  return {
    score,
    weight: typeof weight.data === 'number' ? weight.data : null,
    toNextWeight: score === null ? null : toNextWeight(score),
    attestationsLeft: typeof quota.data === 'number' ? quota.data : null,
  }
}

/** The score of a guardian, when the chain answered with one. */
function scoreOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const score = (data as { score?: unknown }).score
  return typeof score === 'number' ? score : null
}

/** The penalties that are still waiting on each of the targets. */
export function usePendingPenalties(targets: readonly string[]): {
  pending: Record<string, number>
  refetch: () => void
} {
  const core = coreAddress()
  const key = targets.join(',')
  const contracts = useMemo(
    () =>
      core === null
        ? []
        : targets.map(target => ({
            abi: coreAbi,
            address: core,
            functionName: 'pendingPenalties' as const,
            args: [target as Hex],
          })),
    // The contracts are rebuilt only when the targets change, so the read is not repeated.
    [key, core],
  )
  const read = useReadContracts({
    contracts,
    chainId: expectedChainId,
    query: { enabled: core !== null && targets.length > 0 },
  })
  const pending: Record<string, number> = {}
  targets.forEach((target, index) => {
    const value = read.data?.[index]
    pending[target] = typeof value === 'number' ? value : 0
  })
  return { pending, refetch: () => void read.refetch() }
}
