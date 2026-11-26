import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createApp } from '../src/server'
import { createStore } from '../src/store'
import { httpDeps, post } from './httpFixtures'
import { refused, request } from './runFixtures'

afterEach(() => vi.restoreAllMocks())

test('legacy blocked runs are counted without making a usable worker unhealthy', async () => {
  const deps = httpDeps(), path = join(deps.env.RUN_DIR, 'legacy.json')
  writeFileSync(path, JSON.stringify({ ...refused, runId: 'legacy' }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const store = createStore(deps.env.RUN_DIR), app = createApp({ ...deps, store })
  const health = await app.request('/healthz')
  expect(health.status).toBe(200)
  expect(await health.json()).toEqual({ healthy: true, blockedLegacyRuns: 1 })
  expect((await post(app, { ...request, runId: 'legacy' })).status).toBe(429)
  expect((await post(app, { ...request, runId: 'unrelated' })).status).toBe(202)
  await vi.waitFor(() => expect(store.get('unrelated')?.state).toBe('done'))
})

test('multiple blocked legacy records are reported as an aggregate without revealing run IDs', async () => {
  const deps = httpDeps()
  for (const runId of ['legacy-a', 'legacy-b']) writeFileSync(join(deps.env.RUN_DIR, `${runId}.json`), JSON.stringify({ ...refused, runId }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = createApp({ ...deps, store: createStore(deps.env.RUN_DIR) })
  const health = await app.request('/healthz')
  expect(health.status).toBe(200)
  expect(await health.json()).toEqual({ healthy: true, blockedLegacyRuns: 2 })
})

test('a persistence fault still makes health 503 when blocked legacy records coexist', async () => {
  const deps = httpDeps()
  writeFileSync(join(deps.env.RUN_DIR, 'legacy.json'), JSON.stringify({ ...refused, runId: 'legacy' }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const store = createStore(deps.env.RUN_DIR), app = createApp({ ...deps, store })
  vi.spyOn(store, 'save').mockImplementation(() => { throw Error('Disk unavailable.') })
  expect((await post(app)).status).toBe(429)
  const health = await app.request('/healthz')
  expect(health.status).toBe(503)
  expect(await health.json()).toEqual({ healthy: false, blockedLegacyRuns: 1 })
  expect(deps.llm.step).not.toHaveBeenCalled()
})
