'use client'
import { useCallback, useEffect, useState } from 'react'
import type { ActivityItem, NeedsAction } from '@sealflare/shared/schemas'
import { loadActivity } from './api'

/**
 * The activity of the connected account.
 *
 * Without a wallet there is nothing to read, so no request is made at all: the page must not
 * show anything personal before the reader has connected one.
 */
export type ActivityState = {
  needsAction: NeedsAction[]
  history: ActivityItem[]
  loading: boolean
  failed: boolean
  reload: () => void
}

const empty = { needsAction: [] as NeedsAction[], history: [] as ActivityItem[] }

export function useActivity(address: string | null): ActivityState {
  const [reading, setReading] = useState({ needsAction: empty.needsAction, history: empty.history })
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
        setReading(data)
        setFailed(false)
        setLoading(false)
      },
      () => {
        if (!live) return
        setReading(empty)
        setFailed(true)
        setLoading(false)
      },
    )
    return () => { live = false }
  }, [address, round])

  const reload = useCallback(() => setRound(value => value + 1), [])
  return { ...reading, loading, failed, reload }
}
