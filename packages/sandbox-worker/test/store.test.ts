import fs, { readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createStore } from '../src/store'
import { runDirectory, running, refused } from './runFixtures'

afterEach(() => vi.restoreAllMocks())

test('a run is recovered identically from its single JSON file after a restart', () => {
  const dir = runDirectory(), store = createStore(dir)
  store.save(refused)
  expect(readdirSync(dir)).toEqual(['run-1.json'])
  expect(statSync(join(dir, 'run-1.json')).mode & 0o777).toBe(0o600)
  const restarted = createStore(dir)
  expect(restarted.loadAll()).toEqual([])
  expect(restarted.get('run-1')).toEqual(refused)
})

test('store values are isolated from caller mutations on both save and get', () => {
  const store = createStore(runDirectory()), input = structuredClone(refused)
  store.save(input)
  input.probes.length = 0
  const found = store.get('run-1')!
  found.probes.length = 0
  expect(store.get('run-1')).toEqual(refused)
})

test.each(['../x', '/absolute', 'a/b', 'a\\b', '.', '..', 'a\0b', '', 'x'.repeat(65)])
  ('run ID %j cannot escape or alias the storage directory', (runId) => {
    const dir = runDirectory(), store = createStore(dir)
    expect(() => store.save({ ...running, runId })).toThrow()
    expect(() => store.get(runId)).toThrow()
    expect(readdirSync(dir)).toEqual([])
  })

test('corrupt and schema-invalid files are skipped and reported without exposing their contents', () => {
  const dir = runDirectory(), store = createStore(dir)
  store.save(refused)
  writeFileSync(join(dir, 'broken.json'), '{broken-private-data')
  writeFileSync(join(dir, 'invalid.json'), '{}')
  const restarted = createStore(dir), issues = restarted.loadAll()
  expect(issues.map(({ file }) => file).sort()).toEqual(['broken.json', 'invalid.json'])
  expect(JSON.stringify(issues)).not.toContain('broken-private-data')
  expect(restarted.get('run-1')).toEqual(refused)
})

test('a file whose run ID differs from its filename is skipped', () => {
  const dir = runDirectory()
  writeFileSync(join(dir, 'other.json'), JSON.stringify(running))
  const store = createStore(dir)
  expect(store.loadAll().map(({ file }) => file)).toEqual(['other.json'])
  expect(store.get('run-1')).toBeUndefined()
})

test('symlinked status files are never followed on load or save', () => {
  const dir = runDirectory(), outside = join(runDirectory(), 'outside.json')
  writeFileSync(outside, JSON.stringify(refused))
  symlinkSync(outside, join(dir, 'run-1.json'))
  const store = createStore(dir)
  expect(store.loadAll().map(({ file }) => file)).toEqual(['run-1.json'])
  expect(store.get('run-1')).toBeUndefined()
  expect(() => store.save(running)).toThrow()
  expect(JSON.parse(readFileSync(outside, 'utf8'))).toEqual(refused)
})

test('an interrupted replacement preserves the previously saved file and memory', () => {
  const dir = runDirectory(), store = createStore(dir)
  store.save(running)
  vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Error('Simulated disk failure') })
  expect(() => store.save(refused)).toThrow()
  expect(store.get('run-1')).toEqual(running)
  expect(JSON.parse(readFileSync(join(dir, 'run-1.json'), 'utf8'))).toEqual(running)
  expect(readdirSync(dir)).toEqual(['run-1.json'])
})

test('a later save cannot delete or rewrite a captured violation', () => {
  const store = createStore(runDirectory())
  store.save(refused)
  expect(() => store.save(running)).toThrow()
  const rewritten = structuredClone(refused)
  rewritten.probes[0]!.runs[0]!.violations[0]!.args.amount = '1'
  expect(() => store.save(rewritten)).toThrow()
  expect(store.get('run-1')).toEqual(refused)
})

test('invalid evidence and duplicate probe IDs cannot become persisted state', () => {
  const store = createStore(runDirectory())
  expect(() => store.save({ ...refused, probes: [...refused.probes, ...refused.probes] })).toThrow()
  expect(() => store.save({ ...running, state: 'done' })).toThrow()
})
