'use client'
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { expectedChainId } from '../chain/config'

export type ChainTime = { now: number | null; failed: boolean }

/**
 * The timestamp of the latest block of the chain.
 *
 * The contracts compare their timestamps with the timestamp of the block they are in, so the
 * clock of the chain is the clock the settle window is judged by. The clock of the browser is
 * never used: a browser that is behind or ahead would offer a settlement the chain refuses.
 *
 * A chain that cannot be read leaves the moment unknown, and the caller then offers nothing that
 * depends on it.
 */
export function useChainTime(): ChainTime {
  const client = usePublicClient({ chainId: expectedChainId })
  const [time, setTime] = useState<ChainTime>({ now: null, failed: false })
  useEffect(() => {
    if (client === undefined) return
    let live = true
    client.getBlock().then(
      block => {
        if (live) setTime({ now: Number(block.timestamp), failed: false })
      },
      () => {
        if (live) setTime({ now: null, failed: true })
      },
    )
    return () => {
      live = false
    }
  }, [client])
  return time
}
