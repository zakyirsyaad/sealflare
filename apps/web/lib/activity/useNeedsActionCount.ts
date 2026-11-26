'use client'
import { useEffect, useState } from 'react'
import { loadActivity } from './api'

/**
 * How many things wait on the connected account.
 *
 * The mark on the wallet button must be visible without opening the menu, so the count is read
 * on every screen of the application. Without a wallet there is nothing to wait on, and the count
 * of another account is never shown.
 */
export function useNeedsActionCount(address: string | null): number {
  const [reading, setReading] = useState({ address: null as string | null, count: 0 })
  useEffect(() => {
    if (address === null) {
      setReading({ address: null, count: 0 })
      return
    }
    let live = true
    void loadActivity(address).then(
      data => { if (live) setReading({ address, count: data.needsAction.length }) },
      () => { if (live) setReading({ address, count: 0 }) },
    )
    return () => { live = false }
  }, [address])
  return reading.address === address ? reading.count : 0
}
