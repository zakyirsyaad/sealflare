import { z } from 'zod'

export type Budget = { tryTake(calls: number): boolean; canTake(calls: number): boolean; used(): number }
const PositiveCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Process-local call counter. Only a later UTC day can create a new allowance. */
export function createBudget(options: { dailyCalls: number; now?: () => Date }): Budget {
  const limit = PositiveCount.parse(options.dailyCalls), now = options.now ?? (() => new Date())
  let day = '', used = 0
  const refresh = () => {
    const date = now()
    if (!Number.isFinite(date.getTime())) throw Error('Invalid budget clock.')
    const current = date.toISOString().slice(0, 10)
    if (current > day) { day = current; used = 0 }
  }
  return {
    tryTake: (calls) => {
      const count = PositiveCount.parse(calls)
      refresh()
      if (count > limit - used) return false
      used += count
      return true
    },
    used: () => { refresh(); return used },
    canTake: (calls) => { const count = PositiveCount.parse(calls); refresh(); return count <= limit - used },
  }
}
