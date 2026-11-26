'use client'
import { useCallback, useEffect, useState } from 'react'
import type { ActivityItem, NeedsAction } from '@sealflare/shared/schemas'
import { loadActivity } from './api'

/**
 * The activity of the connected account.
 *
 * Without a wallet there is nothing to read, so no request is made at all: the page must not
 * show anything personal before the reader has connected one. The reading belongs to the account
 * it was read for, so the rows of another account are never left on the screen.
 */
export type ActivityState = {
  needsAction: NeedsAction[]
  history: ActivityItem[]
  loading: boolean
  failed: boolean
  reload: () => void
}

/** What was read, and the account it was read for. */
type Reading = { address: string | null; needsAction: NeedsAction[]; history: ActivityItem[] }

const empty: Reading = { address: null, needsAction: [], history: [] }

export function useActivity(address: string | null): ActivityState {
  const [reading, setReading] = useState<Reading>(empty)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (address === null) {
      setReading(empty)
      setFailed(false)
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    void loadActivity(address).then(
      data => {
        if (!live) return
        setReading({ address, needsAction: data.needsAction, history: data.history })
        setFailed(false)
        setLoading(false)
      },
      () => {
        if (!live) return
        setReading({ address, needsAction: [], history: [] })
        setFailed(true)
        setLoading(false)
      },
    )
    return () => { live = false }
  }, [address, round])

  const reload = useCallback(() => setRound(value => value + 1), [])
  // A reading of another account is not the reading of this one, so it is never shown.
  const mine = reading.address === address
  return {
    needsAction: mine ? reading.needsAction : [],
    history: mine ? reading.history : [],
    loading: address !== null && (!mine || loading),
    failed: mine && failed,
    reload,
  }
}
