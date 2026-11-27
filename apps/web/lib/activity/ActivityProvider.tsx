'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ActivityItem, NeedsAction } from '@sealflare/shared/schemas'
import { useUserState } from '../chain/userState'
import { loadActivity } from './api'
import { ACTIVITY_CHANGED } from './activityChanged'
import { useChainTime } from './useChainTime'
import { uniqueRows, visibleRows } from './needsAction'

/** How often the rows of the account are read again. */
const POLL_MS = 30_000

/**
 * The activity of the connected account, read once for the whole application.
 *
 * The My activity page and the mark on the wallet button show the same rows, so they read them
 * once and share them: the mark is not a number of its own that may disagree with the panel. The
 * rows are read again on an interval and whenever a transaction lands, so a claim or a withdrawal
 * does not leave a stale mark behind. Without a wallet there is nothing to read, so no request is
 * made at all. The reading belongs to the account it was read for, so the rows of another
 * account are never left on the screen.
 */
export type SharedActivity = {
  /** The rows that wait on the account and that can still be acted on. */
  needsAction: NeedsAction[]
  /** What the account did. */
  history: ActivityItem[]
  /** The rows are being read. */
  loading: boolean
  /** The rows could not be read. */
  failed: boolean
  /** How many things wait on the account, or null when the rows could not be read. */
  count: number | null
  /** The time of the chain, as the latest block says it. */
  now: Date | null
  /** Reads the rows of the account again. */
  reload: () => void
}

/** What was read, and the account it was read for. */
type Reading = { address: string | null; needsAction: NeedsAction[]; history: ActivityItem[] }

const empty: Reading = { address: null, needsAction: [], history: [] }

/** The activity of an application that has no provider: nothing waits on the account. */
const nothing: SharedActivity = {
  needsAction: [],
  history: [],
  loading: false,
  failed: false,
  count: 0,
  now: null,
  reload: () => {},
}

const ActivityContext = createContext<SharedActivity | null>(null)

/** Reads the activity of the connected account and shares it with the whole application. */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const user = useUserState()
  const address = 'address' in user ? user.address : null
  const now = useChainTime()
  const [reading, setReading] = useState<Reading>(empty)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [round, setRound] = useState(0)
  // The account whose rows have answered. The screen waits for the first answer of an account,
  // and a later read keeps the rows that are on the screen.
  const answered = useRef<string | null>(null)

  useEffect(() => {
    if (address === null) {
      answered.current = null
      setReading(empty)
      setFailed(false)
      setLoading(false)
      return
    }
    let live = true
    const read = () => {
      // The rows stay on the screen while a later read runs, so the page does not jump every
      // time the rows are read again.
      if (answered.current !== address) setLoading(true)
      void loadActivity(address).then(
        data => {
          if (!live) return
          answered.current = address
          setReading({ address, needsAction: data.needsAction, history: data.history })
          setFailed(false)
          setLoading(false)
        },
        () => {
          if (!live) return
          // The rows of the account stay only when this account has answered before. A first
          // read that failed leaves the screen with the error of the read, and not with a
          // skeleton that waits for ever.
          if (answered.current !== address) {
            setReading({ address, needsAction: [], history: [] })
          }
          setFailed(true)
          setLoading(false)
        },
      )
    }
    read()
    // The rows are read again on an interval, so a row that becomes due is not a day old.
    const timer = setInterval(read, POLL_MS)
    const onChanged = () => read()
    window.addEventListener(ACTIVITY_CHANGED, onChanged)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener(ACTIVITY_CHANGED, onChanged)
    }
  }, [address, round])

  const reload = useCallback(() => setRound(value => value + 1), [])
  // A reading of another account is not the reading of this one, so it is never shown.
  const mine = reading.address === address
  const value = useMemo<SharedActivity>(() => {
    const rows = mine ? uniqueRows(visibleRows(reading.needsAction, now)) : []
    return {
      needsAction: rows,
      history: mine ? reading.history : [],
      loading: address !== null && (!mine || loading),
      failed: mine && failed,
      // A read that failed does not say that nothing waits on the account.
      count: address === null ? 0 : failed ? null : rows.length,
      now,
      reload,
    }
  }, [mine, reading, loading, failed, address, now, reload])
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

/**
 * The activity of the connected account.
 *
 * A screen outside the provider has no activity to show, and says nothing about the account.
 */
export function useSharedActivity(): SharedActivity {
  return useContext(ActivityContext) ?? nothing
}
