'use client'
import { useCallback, useEffect, useRef } from 'react'

/** The flag that says the panel was left. */
export type Cancelled = { current: boolean }

/**
 * A flag that says the panel was left.
 *
 * The wallet asks for a signature or for a confirmation, and the user may close the panel while
 * it waits. The attempt then stops at the next step: nothing is pinned and no transaction is
 * sent. The flag is also set when the panel goes away without a close, for example a navigation.
 */
export function useCancel() {
  const cancelled = useRef(false)
  useEffect(
    () => () => {
      cancelled.current = true
    },
    [],
  )
  /** The panel was left. The attempt stops at its next step. */
  const cancel = useCallback(() => {
    cancelled.current = true
  }, [])
  /** A new attempt starts, so the attempt is not cancelled. */
  const resume = useCallback(() => {
    cancelled.current = false
  }, [])
  return { cancelled, cancel, resume }
}
