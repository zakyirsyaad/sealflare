'use client'
import { useEffect, useState } from 'react'
import { ACTIVITY_CHANGED } from './activityChanged'
import { loadActivity } from './api'

/**
 * How many things wait on the connected account.
 *
 * The mark on the wallet button must be visible without opening the menu, so the count is read
 * on every screen of the application. Without a wallet there is nothing to wait on, and the count
 * of another account is never shown. The count is read again when the rows of the account change,
 * so a settlement on one screen does not leave a stale mark on the other screens.
 */
export function useNeedsActionCount(address: string | null): number {
  const [reading, setReading] = useState({ address: null as string | null, count: 0 })
  useEffect(() => {
    if (address === null) {
      setReading({ address: null, count: 0 })
      return
    }
    let live = true
    const read = () => {
      void loadActivity(address).then(
        data => { if (live) setReading({ address, count: data.needsAction.length }) },
        () => { if (live) setReading({ address, count: 0 }) },
      )
    }
    read()
    window.addEventListener(ACTIVITY_CHANGED, read)
    return () => {
      live = false
      window.removeEventListener(ACTIVITY_CHANGED, read)
    }
  }, [address])
  return reading.address === address ? reading.count : 0
}
