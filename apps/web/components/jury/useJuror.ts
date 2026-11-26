'use client'
import { useReadContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { expectedChainId } from '../../lib/chain/config'
import { courtAddress } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'

/** What the Court holds about one juror in one dispute. */
export type JurorState = { committed: boolean; revealed: boolean; uphold: boolean; commitHash: Hex }

export type JurorChain = {
  /** The wallet that is connected, or null. */
  account: Address | null
  /** The `JurorStatus` the Court names for this wallet. Null until the Court answers. */
  status: number | null
  /** Null until the Court answers. */
  juror: JurorState | null
  /** Reads both again and answers with the commitment the Court holds now. Null when it cannot be read. */
  refetch: () => Promise<JurorState | null>
}

/** How often the Court is asked again, so the box follows a commit or a reveal without a reload. */
const REFRESH_MS = 15_000

function asJuror(value: unknown): JurorState | null {
  if (value === null || typeof value !== 'object') return null
  const { committed, revealed, uphold, commitHash } = value as Record<string, unknown>
  if (typeof committed !== 'boolean' || typeof revealed !== 'boolean' || typeof uphold !== 'boolean') return null
  if (typeof commitHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(commitHash)) return null
  return { committed, revealed, uphold, commitHash: commitHash.toLowerCase() as Hex }
}

/**
 * The eligibility and the commitment of the connected wallet in one dispute, read from the Court.
 *
 * Both come from the chain and never from the index, because an index that lags would let a juror
 * reveal against a commit it has not seen yet, or join twice.
 */
export function useJuror(challengeId: string): JurorChain {
  const user = useUserState()
  const account = 'address' in user ? user.address : null
  const court = courtAddress()
  const base = {
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    args: account === null ? undefined : [BigInt(challengeId), account],
    query: { enabled: court !== null && account !== null, refetchInterval: REFRESH_MS },
  } as const
  const status = useReadContract({ ...base, functionName: 'jurorStatus' } as Parameters<typeof useReadContract>[0])
  const juror = useReadContract({ ...base, functionName: 'getJuror' } as Parameters<typeof useReadContract>[0])
  return {
    account,
    status: typeof status.data === 'number' ? status.data : null,
    juror: asJuror(juror.data),
    refetch: async () => {
      try {
        const [, read] = await Promise.all([status.refetch(), juror.refetch()])
        return asJuror(read?.data)
      } catch {
        return null
      }
    },
  }
}
