'use client'
import { useEffect, useState } from 'react'

/**
 * The moment the screen reads.
 *
 * The clock moves on its own, so a countdown does not freeze on the moment the page was opened.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
