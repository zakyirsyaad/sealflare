import fs, { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { WorkerRunResponse, WorkerRunStatus } from '@sealflare/shared/schemas'
import { createApp } from '../src/server'
import { createBudget } from '../src/budget'
import { createStore } from '../src/store'
import { httpDeps, post, statusOf } from './httpFixtures'
import { request, running, refused } from './runFixtures'

afterEach(() => vi.restoreAllMocks())

test('admission with fewer than eighteen remaining calls rejects before spending', async () => {
  const deps = httpDeps(), budget = createBudget({ dailyCalls: 20 }); budget.tryTake(3)
  const response = await post(createApp({ ...deps, budget }))
  expect(response.status).toBe(429)
  expect(WorkerRunResponse.parse(await response.json())).toEqual({ accepted: false, reason: 'DAILY_LIMIT' })
  expect(budget.used()).toBe(3)
  expect(deps.llm.step).not.toHaveBeenCalled()
})

test('an ID conflict uses the existing admission response schema without replacing evidence', async () => {
  const deps = httpDeps(), app = createApp(deps)
  await post(app)
  await vi.waitFor(() => expect(deps.store.get(request.runId)?.state).toBe('done'))
  const previous = deps.store.get(request.runId), response = await post(app, { ...request, skillMd: '# Different' })
  expect(response.status).toBe(429)
  expect(WorkerRunResponse.parse(await response.json())).toEqual({ accepted: false, reason: 'BUSY' })
  expect(deps.store.get(request.runId)).toEqual(previous)
})

test('one legacy running record is reported and retained without crash-looping or being rerun', async () => {
  const deps = httpDeps(), path = join(deps.env.RUN_DIR, 'legacy.json')
  writeFileSync(path, JSON.stringify({ ...refused, runId: 'legacy' }))
  const original = readFileSync(path, 'utf8'), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = createApp({ ...deps, store: createStore(deps.env.RUN_DIR) })
  expect((await app.request('/healthz')).status).toBe(200)
  expect(readFileSync(path, 'utf8')).toBe(original)
  const response = await post(app, { ...request, runId: 'legacy' })
  expect(response.status).toBe(429)
  expect(warn).toHaveBeenCalled()
  expect(deps.llm.step).not.toHaveBeenCalled()
})

test('an unexpected read exception does not hide other completed statuses or permanently fault health', async () => {
  const deps = httpDeps(), app = createApp(deps)
  await post(app); await vi.waitFor(() => expect(deps.store.get(request.runId)?.state).toBe('done'))
  const get = deps.store.get
  vi.spyOn(deps.store, 'get').mockImplementation((id) => { if (id === 'bad') throw Error('unexpected input'); return get(id) })
  expect((await statusOf(app, 'bad')).response.status).toBe(503)
  expect((await app.request('/healthz')).status).toBe(200)
  expect((await statusOf(app)).response.status).toBe(200)
})

test('storage failure blocks new admissions with schema-valid BUSY but completed evidence remains readable', async () => {
  const deps = httpDeps(), app = createApp(deps)
  await post(app); await vi.waitFor(() => expect(deps.store.get(request.runId)?.state).toBe('done'))
  vi.spyOn(deps.store, 'save').mockImplementation(() => { throw Error('disk failure') })
  const response = await post(app, { ...request, runId: 'run-2' })
  expect(response.status).toBe(429)
  expect(WorkerRunResponse.parse(await response.json())).toEqual({ accepted: false, reason: 'BUSY' })
  expect((await app.request('/healthz')).status).toBe(503)
  expect((await statusOf(app)).response.status).toBe(200)
})

test.each(['admission', 'run'] as const)('budget persistence failure during %s faults health and never contacts the model', async (phase) => {
  const deps = httpDeps(), file = join(deps.env.RUN_DIR, '.budget')
  const budget = createBudget({ dailyCalls: 100, file }), app = createApp({ ...deps, budget })
  if (phase === 'run') budget.canTake(18) // Commit today's zero snapshot so the next write is a charged attempt.
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (String(destination) === file) throw Object.assign(Error('disk failure'), { code: 'ENOSPC' })
    return rename(source, destination)
  })
  const response = await post(app)
  expect(response.status).toBe(phase === 'admission' ? 429 : 202)
  await vi.waitFor(async () => expect((await app.request('/healthz')).status).toBe(503))
  expect(deps.llm.step).not.toHaveBeenCalled()
  expect((await post(app, { ...request, runId: 'another' })).status).toBe(429)
  if (phase === 'run') {
    const status = await statusOf(app)
    expect(status.response.status).toBe(200)
    expect(WorkerRunStatus.parse(status.body).failure?.cause).toBe('infrastructure')
  }
})
