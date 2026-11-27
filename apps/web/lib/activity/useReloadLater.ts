'use client'
import { useCallback, useEffect, useRef } from 'react'

/** The moments at which the rows are read again after a transaction landed. */
const DELAYS = [5_000, 20_000, 60_000]

/**
 * Reads the rows of the account again after a transaction landed.
 *
 * The indexer reads a transaction only once its block is final, so the rows are read again a few
 * times after the receipt arrives: once at once, and again when the indexer may have reached the
 * block. The timers are cleared when the screen is left, so a screen that is gone does not read
 * the account any more.
 */
export function useReloadLater(reload: () => void): () => void {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const latest = useRef(reload)
  latest.current = reload
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    },
    [],
  )
  return useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = DELAYS.map(delay => setTimeout(() => latest.current(), delay))
    latest.current()
  }, [])
}
