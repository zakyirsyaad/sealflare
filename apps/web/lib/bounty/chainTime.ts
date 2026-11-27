'use client'
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { expectedChainId } from '../chain/config'

export type ChainTime = { now: number | null; failed: boolean }

/** How often the time of the chain is read again, in milliseconds. */
export const CHAIN_REFRESH = 60_000

/**
 * The timestamp of the latest block of the chain.
 *
 * The contracts compare their timestamps with the timestamp of the block they are in, so the
 * clock of the chain is the clock the settle window is judged by. The clock of the browser is
 * never used: a browser that is behind or ahead would offer a settlement the chain refuses.
 *
 * The time is read again every minute, so a page that is left open does not decide the window
 * of a bounty on a stale clock.
 *
 * A chain that cannot be read leaves the moment unknown, and the caller then offers nothing that
 * depends on it.
 */
export function useChainTime(): ChainTime {
  const client = usePublicClient({ chainId: expectedChainId })
  const [time, setTime] = useState<ChainTime>({ now: null, failed: false })
  useEffect(() => {
    const reader = client
    if (reader === undefined) {
      // Without a client the chain cannot be read, and the caller then offers nothing that
      // depends on the time of the chain.
      setTime({ now: null, failed: true })
      return
    }
    let live = true
    const read = (): void => {
      reader.getBlock().then(
        block => {
          if (live) setTime({ now: Number(block.timestamp), failed: false })
        },
        () => {
          if (live) setTime({ now: null, failed: true })
        },
      )
    }
    read()
    const timer = setInterval(read, CHAIN_REFRESH)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [client])
  return time
}
