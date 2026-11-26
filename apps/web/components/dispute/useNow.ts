'use client'
import { useEffect, useState } from 'react'

/** The clock of the page, for the countdowns. It only shows time left, never decides a phase. */
export function useNow(intervalMs = 20_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
