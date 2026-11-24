import fs, { readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createStore } from '../src/store'
import { recoveryFor } from '../src/runIdentity'
import { request, runDirectory, running, refused } from './runFixtures'

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

test('a directory flush failure after rename retains committed evidence in memory and blocks later erasure', () => {
  const dir = runDirectory(), store = createStore(dir)
  store.save(running)
  const original = fs.fsyncSync
  const sync = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
    if (fs.fstatSync(fd).isDirectory()) throw Error('Directory flush failed')
    original(fd)
  })
  expect(() => store.save(refused)).toThrow('Directory flush failed')
  sync.mockRestore()
  expect(JSON.parse(readFileSync(join(dir, 'run-1.json'), 'utf8'))).toEqual(refused)
  expect(store.get('run-1')).toEqual(refused)
  expect(() => store.save(running)).toThrow()
  expect(JSON.parse(readFileSync(join(dir, 'run-1.json'), 'utf8'))).toEqual(refused)
})

test('recovery identity survives ordinary progress saves and restart without leaking into public status', () => {
  const dir = runDirectory(), store = createStore(dir), metadata = recoveryFor(request, '2026-11-25T12:00:00.000Z')
  store.save(running, metadata)
  store.save(refused)
  const restarted = createStore(dir)
  expect(restarted.loadAll()).toEqual([])
  expect(restarted.recovery('run-1')).toEqual(metadata)
  expect(restarted.list()).toEqual([refused])
  expect(restarted.get('run-1')).toEqual(refused)
  expect(JSON.stringify(restarted.get('run-1'))).not.toContain(request.bundleHash)
  const returned = restarted.recovery('run-1')!
  returned.modelId = 'changed'
  expect(restarted.recovery('run-1')?.modelId).toBe('fixture-model')
  expect(() => restarted.save(refused, { ...metadata, modelId: 'rebound' })).toThrow()
})

test('a final result cannot disagree with the recovery identity used by its request', () => {
  const store = createStore(runDirectory()), metadata = recoveryFor(request, '2026-11-25T12:00:00.000Z')
  store.save(refused, metadata)
  const result = { schemaVersion: 1 as const, bundleHash: request.bundleHash, modelId: 'wrong-model',
    probeSetVersion: request.probeSetVersion, startedAt: metadata.startedAt, finishedAt: metadata.startedAt,
    status: 'SANDBOX_FUZZ_FAILED' as const, probes: refused.probes }
  expect(() => store.save({ ...refused, state: 'done', result })).toThrow()
  expect(store.get(request.runId)).toEqual(refused)
})
