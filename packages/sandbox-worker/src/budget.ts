import { z } from 'zod'
import fs from 'node:fs'
import { resolve } from 'node:path'
import { replaceFile } from './atomicFile'

export type Budget = { tryTake(calls: number): boolean; canTake(calls: number): boolean; used(): number }
export class BudgetStorageError extends Error {}
const PositiveCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const Snapshot = z.object({ day: z.iso.date(), used: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()

function load(file: string): z.infer<typeof Snapshot> | undefined {
  let stat: fs.Stats
  try { stat = fs.lstatSync(file) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (!stat.isFile() || stat.size > 1024) throw Error('Invalid budget state.')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 1024) throw Error('Invalid budget state.')
    return Snapshot.parse(JSON.parse(fs.readFileSync(fd, 'utf8')))
  } finally { fs.closeSync(fd) }
}

/** One worker's daily counter; a configured private file preserves spend across process restarts. */
export function createBudget(options: { dailyCalls: number; now?: () => Date; file?: string }): Budget {
  const limit = PositiveCount.parse(options.dailyCalls), now = options.now ?? (() => new Date())
  const file = options.file === undefined ? undefined : resolve(z.string().min(1).parse(options.file))
  const previous = file ? load(file) : undefined
  let day = previous?.day ?? '', used = previous?.used ?? 0
  const save = (nextDay: string, nextUsed: number) => {
    const commit = () => { day = nextDay; used = nextUsed }
    if (file) {
      try { replaceFile(file, JSON.stringify({ day: nextDay, used: nextUsed }), commit) }
      catch { throw new BudgetStorageError('Budget storage is unavailable.') }
    } else commit()
  }
  const refresh = () => {
    const date = now()
    if (!Number.isFinite(date.getTime())) throw Error('Invalid budget clock.')
    const current = date.toISOString().slice(0, 10)
    if (current > day) save(current, 0)
  }
  return {
    tryTake: (calls) => {
      const count = PositiveCount.parse(calls)
      refresh()
      if (count > limit - used) return false
      save(day, used + count)
      return true
    },
    used: () => { refresh(); return used },
    canTake: (calls) => { const count = PositiveCount.parse(calls); refresh(); return count <= limit - used },
  }
}
