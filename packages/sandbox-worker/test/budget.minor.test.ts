import fs, { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createBudget } from '../src/budget'
import { createStore } from '../src/store'
import { refused, runDirectory } from './runFixtures'

afterEach(() => vi.restoreAllMocks())

test('daily spend survives restarts and only a later UTC day creates a new allowance', () => {
  const file = join(runDirectory(), '.budget'), options = { file, dailyCalls: 3, now: () => time }
  let time = new Date('2026-11-25T23:59:59Z')
  expect(createBudget(options).tryTake(2)).toBe(true)
  const restarted = createBudget(options)
  expect(restarted.used()).toBe(2)
  expect(restarted.tryTake(2)).toBe(false)
  expect(restarted.tryTake(1)).toBe(true)
  expect(createBudget(options).tryTake(1)).toBe(false)
  time = new Date('2026-11-26T00:00:00Z')
  expect(createBudget(options).tryTake(3)).toBe(true)
  time = new Date('2026-11-25T20:00:00Z')
  expect(createBudget(options).tryTake(1)).toBe(false)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ day: '2026-11-26', used: 3 })
})

test('corrupt or symlinked budget state cannot reset the breaker', () => {
  const directory = runDirectory(), file = join(directory, '.budget')
  writeFileSync(file, '{broken')
  expect(() => createBudget({ file, dailyCalls: 3 })).toThrow()
  fs.rmSync(file); fs.symlinkSync(join(directory, 'missing'), file)
  expect(() => createBudget({ file, dailyCalls: 3 })).toThrow()
})

test('a failed counter write cannot grant a model call', () => {
  const file = join(runDirectory(), '.budget'), now = () => new Date('2026-11-25T12:00:00Z')
  const budget = createBudget({ file, dailyCalls: 3, now })
  budget.canTake(1)
  vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Error('disk unavailable') })
  expect(() => budget.tryTake(1)).toThrow()
})

test('Windows status saves do not fail because directory fsync is unsupported', () => {
  const store = createStore(runDirectory()), descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  const open = fs.openSync
  vi.spyOn(fs, 'openSync').mockImplementation(((path, ...args) => {
    if (fs.existsSync(path) && fs.statSync(path).isDirectory()) throw Object.assign(Error('unsupported'), { code: 'EISDIR' })
    return open(path, ...args)
  }) as typeof fs.openSync)
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    expect(() => store.save(refused)).not.toThrow()
    expect(store.get(refused.runId)).toEqual(refused)
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
