import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createApp } from '../src/server'
import { createStore } from '../src/store'
import { httpDeps, post } from './httpFixtures'
import { refused, request } from './runFixtures'

afterEach(() => vi.restoreAllMocks())

test('legacy blocked runs make health terminal while unrelated run IDs remain admissible', async () => {
  const deps = httpDeps(), path = join(deps.env.RUN_DIR, 'legacy.json')
  writeFileSync(path, JSON.stringify({ ...refused, runId: 'legacy' }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = createApp({ ...deps, store: createStore(deps.env.RUN_DIR) })
  const health = await app.request('/healthz')
  expect(health.status).toBe(503)
  expect(await health.json()).toEqual({ healthy: false })
  expect((await post(app, { ...request, runId: 'unrelated' })).status).toBe(202)
})
