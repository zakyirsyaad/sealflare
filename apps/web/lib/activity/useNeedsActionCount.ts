'use client'
import { useEffect, useState } from 'react'
import { loadActivity } from './api'

/**
 * How many things wait on the connected account.
 *
 * The mark on the wallet button must be visible without opening the menu, so the count is read
 * on every screen of the application. Without a wallet there is nothing to wait on.
 */
export function useNeedsActionCount(address: string | null): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (address === null) {
      setCount(0)
      return
    }
    let live = true
    void loadActivity(address).then(
      data => { if (live) setCount(data.needsAction.length) },
      () => { if (live) setCount(0) },
    )
    return () => { live = false }
  }, [address])
  return count
}
