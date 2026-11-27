'use client'
import { useBlock } from 'wagmi'
import { expectedChainId } from '../chain/config'

/** How often the latest block is read again. */
const REFRESH_MS = 30_000

/**
 * The time of the chain, as the latest block says it.
 *
 * A deadline of the screen is compared with the time of the chain and not with the clock of the
 * browser, so a browser that is a few minutes off does not move the moment a stake is lost. The
 * time is null while the chain has not answered, and a deadline is not compared with a guess.
 */
export function useChainTime(): Date | null {
  const block = useBlock({ chainId: expectedChainId, query: { refetchInterval: REFRESH_MS } })
  const timestamp = block.data?.timestamp
  if (typeof timestamp !== 'bigint') return null
  return new Date(Number(timestamp) * 1000)
}
