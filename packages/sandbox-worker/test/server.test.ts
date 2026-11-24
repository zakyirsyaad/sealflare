import crypto from 'node:crypto'
import fs from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { PROBE_IDS, SandboxResult, WorkerRunResponse, WorkerRunStatus } from '@sealflare/shared/schemas'
import { createApp } from '../src/server'
import { createStore } from '../src/store'
import { createBudget } from '../src/budget'
import { recoveryFor } from '../src/runIdentity'
import { LlmInfrastructureError } from '../src/llm'
import { request, running, refused } from './runFixtures'
import { bearer, credentials, fixtureCid, httpDeps, post, statusOf } from './httpFixtures'

afterEach(() => vi.restoreAllMocks())

test('health is public; run endpoints require the bearer key before starting or reading anything', async () => {
  const dependencies = httpDeps(), app = createApp(dependencies)
  expect((await app.request('/healthz')).status).toBe(200)
  expect((await post(app, request, '')).status).toBe(401)
  expect((await app.request('/runs/run-1')).status).toBe(401)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
  expect(dependencies.budget.used()).toBe(0)
  expect(dependencies.store.get('run-1')).toBeUndefined()
})

test('bearer comparison uses constant-sized timingSafeEqual buffers even for different-length tokens', async () => {
  const app = createApp(httpDeps()), compare = vi.spyOn(crypto, 'timingSafeEqual')
  for (const token of ['x', 'x'.repeat(100), `${bearer}x`, bearer]) {
    const response = await app.request('/runs/missing', { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(token === bearer ? 404 : 401)
  }
  expect(compare).toHaveBeenCalledTimes(4)
  expect(compare.mock.calls.every(([left, right]) => left.byteLength === 32 && right.byteLength === 32)).toBe(true)
})

test('a valid request returns 202 while its run is visible, then uploads the schema-valid result', async () => {
  const gate = Promise.withResolvers<void>(), dependencies = httpDeps()
  dependencies.llm.step.mockImplementation(async () => { await gate.promise; return { toolCalls: [], text: '', done: true } })
  const app = createApp(dependencies), accepted = await post(app)
  expect(accepted.status).toBe(202)
  expect(WorkerRunResponse.parse(await accepted.json())).toEqual({ accepted: true })
  const progress = await statusOf(app)
  expect(WorkerRunStatus.parse(progress.body).state).toBe('running')
  gate.resolve()
  await vi.waitFor(() => expect(dependencies.store.get(request.runId)?.evidenceURI).toBe(fixtureCid))
  const completed = await statusOf(app)
  expect(completed.response.status).toBe(200)
  expect(WorkerRunStatus.parse(completed.body).result?.status).toBe('NO_VIOLATION_OBSERVED')
  expect(dependencies.llm.step).toHaveBeenCalledTimes(18)
  expect(dependencies.upload).toHaveBeenCalledTimes(1)
  expect(SandboxResult.parse(JSON.parse(dependencies.upload.mock.calls[0]![0]))).toEqual(WorkerRunStatus.parse(completed.body).result)
  expect(JSON.stringify(completed.body)).not.toContain('_recovery')
})

test.each([{}, { ...request, skillMd: '' }, { ...request, skillMd: 'x'.repeat(65_537) },
  { ...request, skillMd: '🦭'.repeat(16_385) }, { ...request, runId: '../escape' }, { ...request, probeSetVersion: 'wrong' }])
  ('invalid request is 400 without consuming quota, starting work, or exposing secrets', async (input) => {
    const dependencies = httpDeps(), app = createApp(dependencies), response = await post(app, input)
    expect(response.status).toBe(400)
    const text = await response.text()
    for (const value of [bearer, credentials.ANTHROPIC_API_KEY, credentials.PINATA_JWT]) expect(text).not.toContain(value)
    expect(dependencies.llm.step).not.toHaveBeenCalled()
    expect(dependencies.budget.used()).toBe(0)
  })

test('malformed JSON and an oversized raw body are rejected before admission', async () => {
  const dependencies = httpDeps(), app = createApp(dependencies)
  for (const [body, status] of [['{', 400], ['x'.repeat(500_000), 413]] as const) {
    const response = await app.request('/runs', { method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body })
    expect(response.status).toBe(status)
  }
  expect(dependencies.llm.step).not.toHaveBeenCalled()
})

test('a concurrent second run is BUSY and never starts another LLM request', async () => {
  const gate = Promise.withResolvers<void>(), dependencies = httpDeps()
  dependencies.llm.step.mockImplementation(async () => { await gate.promise; return { toolCalls: [], text: '', done: true } })
  const app = createApp(dependencies)
  const first = await post(app), second = await post(app, { ...request, runId: 'run-2' })
  expect(first.status).toBe(202)
  expect(second.status).toBe(429)
  expect(WorkerRunResponse.parse(await second.json())).toEqual({ accepted: false, reason: 'BUSY' })
  expect(dependencies.llm.step).toHaveBeenCalledTimes(1)
  gate.resolve()
  await vi.waitFor(() => expect(dependencies.store.get(request.runId)?.evidenceURI).toBe(fixtureCid))
})

test('exhausted budget returns DAILY_LIMIT and an admission check never consumes an extra call', async () => {
  const dependencies = httpDeps(), budget = createBudget({ dailyCalls: 1 })
  budget.tryTake(1)
  const app = createApp({ ...dependencies, budget }), response = await post(app)
  expect(response.status).toBe(429)
  expect(WorkerRunResponse.parse(await response.json())).toEqual({ accepted: false, reason: 'DAILY_LIMIT' })
  expect(budget.used()).toBe(1)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
  expect(dependencies.store.get(request.runId)).toBeUndefined()
})

test('reposting the same run is idempotent; a different request cannot reuse its ID', async () => {
  const dependencies = httpDeps(), app = createApp(dependencies)
  expect((await post(app)).status).toBe(202)
  await vi.waitFor(() => expect(dependencies.store.get(request.runId)?.evidenceURI).toBe(fixtureCid))
  expect((await post(app)).status).toBe(202)
  expect((await post(app, { ...request, skillMd: '# Different' })).status).toBe(409)
  expect(dependencies.llm.step).toHaveBeenCalledTimes(18)
  expect(dependencies.budget.used()).toBe(18)
  const restarted = createApp({ ...dependencies, store: createStore(dependencies.env.RUN_DIR) })
  expect((await post(restarted)).status).toBe(202)
  expect(dependencies.llm.step).toHaveBeenCalledTimes(18)
})

test('unknown run IDs return 404 and invalid path IDs do not reach storage', async () => {
  const app = createApp(httpDeps())
  expect((await statusOf(app, 'missing')).response.status).toBe(404)
  expect((await statusOf(app, 'bad%5Cid')).response.status).toBe(400)
})

test('an upload failure keeps the durable result without exposing the provider exception', async () => {
  const dependencies = httpDeps()
  dependencies.upload.mockRejectedValue(Error(`Failed ${credentials.PINATA_JWT}`))
  const app = createApp(dependencies)
  expect((await post(app)).status).toBe(202)
  await vi.waitFor(() => expect(dependencies.upload).toHaveBeenCalledTimes(1))
  const status = await statusOf(app)
  expect(WorkerRunStatus.parse(status.body).state).toBe('done')
  expect(WorkerRunStatus.parse(status.body).evidenceURI).toBeUndefined()
  expect(JSON.stringify(status.body)).not.toContain(credentials.PINATA_JWT)
})

test.each([running, refused])('restart finalizes interrupted $currentProbe progress and preserves violations', async (progress) => {
  const dependencies = httpDeps(), recovery = recoveryFor(request, '2026-11-25T12:00:00.000Z')
  dependencies.store.save(progress, recovery)
  const restartedStore = createStore(dependencies.env.RUN_DIR), app = createApp({ ...dependencies, store: restartedStore })
  const status = WorkerRunStatus.parse((await statusOf(app)).body)
  expect(status.state).toBe('done')
  expect(status.failure?.cause).toBe('infrastructure')
  expect(status.result?.status).toBe(progress === refused ? 'SANDBOX_FUZZ_FAILED' : 'INCOMPLETE')
  expect(status.result?.bundleHash).toBe(request.bundleHash)
  expect(status.result?.modelId).toBe(request.modelId)
  expect(status.probes).toEqual(progress.probes)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
  const secondRestart = createStore(dependencies.env.RUN_DIR)
  secondRestart.loadAll()
  expect(secondRestart.get(request.runId)).toEqual(status)
  expect(JSON.parse(readFileSync(join(dependencies.env.RUN_DIR, 'run-1.json'), 'utf8'))._recovery).toEqual(recovery)
})

test('a running status with all clean probes cannot become a clean result during crash recovery', async () => {
  const dependencies = httpDeps()
  const probes = PROBE_IDS.map((probeId) => ({ probeId, runs: [0, 1, 2].map((index) => ({ index: index as 0 | 1 | 2,
    outcome: 'clean' as const, violations: [] })) }))
  dependencies.store.save({ ...running, probes }, recoveryFor(request, '2026-11-25T12:00:00.000Z'))
  const app = createApp({ ...dependencies, store: createStore(dependencies.env.RUN_DIR) })
  expect(WorkerRunStatus.parse((await statusOf(app)).body).result?.status).toBe('INCOMPLETE')
})

test('legacy interrupted progress without identity metadata stops startup rather than fabricating a result', () => {
  const dependencies = httpDeps()
  dependencies.store.save(refused)
  expect(() => createApp({ ...dependencies, store: createStore(dependencies.env.RUN_DIR) })).toThrow(/recovery metadata/i)
})

test('a corrupted persisted file is reported without its contents while valid entries remain available', async () => {
  const dependencies = httpDeps()
  writeFileSync(join(dependencies.env.RUN_DIR, 'broken.json'), '{private-corrupt-data')
  const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const app = createApp(dependencies)
  expect((await app.request('/healthz')).status).toBe(200)
  expect(report).toHaveBeenCalled()
  expect(JSON.stringify(report.mock.calls)).not.toContain('private-corrupt-data')
})

test('a completed infrastructure failure remains a valid result and the worker accepts later work', async () => {
  const dependencies = httpDeps()
  dependencies.llm.step.mockRejectedValueOnce(new LlmInfrastructureError('Provider unavailable'))
  const app = createApp(dependencies)
  expect((await post(app)).status).toBe(202)
  await vi.waitFor(() => expect(dependencies.store.get(request.runId)?.evidenceURI).toBe(fixtureCid))
  expect(WorkerRunStatus.parse((await statusOf(app)).body).result?.status).toBe('INCOMPLETE')
  expect((await post(app, { ...request, runId: 'run-2' })).status).toBe(202)
  await vi.waitFor(() => expect(dependencies.store.get('run-2')?.evidenceURI).toBe(fixtureCid))
})

test('an initial persistence failure returns 503 and never spends a model call', async () => {
  const dependencies = httpDeps(), store = { ...dependencies.store, save: () => { throw Error(credentials.PINATA_JWT) } }
  const app = createApp({ ...dependencies, store }), response = await post(app)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain(credentials.PINATA_JWT)
  expect((await app.request('/healthz')).status).toBe(503)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
  expect(dependencies.budget.used()).toBe(0)
})

test('a transient violation-save failure recovers the attempted evidence rather than an older clean snapshot', async () => {
  const dependencies = httpDeps(), base = dependencies.store
  let failed = false
  const store = { ...base, save: ((status, metadata) => {
    if (!failed && status.probes.some(({ runs }) => runs.some(({ outcome }) => outcome === 'violation'))) {
      failed = true
      throw Error('Simulated transient persistence failure')
    }
    base.save(status, metadata)
  }) as typeof base.save }
  dependencies.llm.step.mockImplementation(async () => ({ text: '', done: true, toolCalls: [{
    tool: 'approve', args: { token: 'USDT', amount: 'max', spender: '0x3333333333333333333333333333333333333333' },
  }] }))
  const app = createApp({ ...dependencies, store })
  expect((await post(app)).status).toBe(202)
  await vi.waitFor(() => expect(base.get(request.runId)?.state).toBe('done'))
  expect(base.get(request.runId)?.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(base.get(request.runId)?.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
  expect(dependencies.llm.step).toHaveBeenCalledTimes(1)
})

test('persistent progress-write failure stops admission and never exposes an older partial verdict', async () => {
  const dependencies = httpDeps(), base = dependencies.store
  const store = { ...base, save: ((status, metadata) => {
    if (status.probes.some(({ runs }) => runs.length > 0)) throw Error('Persistent disk failure')
    base.save(status, metadata)
  }) as typeof base.save }
  const app = createApp({ ...dependencies, store })
  expect((await post(app)).status).toBe(202)
  await vi.waitFor(async () => expect((await app.request('/healthz')).status).toBe(503))
  expect((await statusOf(app)).response.status).toBe(503)
  expect((await post(app, { ...request, runId: 'run-2' })).status).toBe(503)
  expect(dependencies.llm.step).toHaveBeenCalledTimes(1)
})

test('the worker remains BUSY until evidence upload settles', async () => {
  const dependencies = httpDeps(), gate = Promise.withResolvers<string>()
  dependencies.upload.mockImplementation(() => gate.promise)
  const app = createApp(dependencies)
  await post(app)
  await vi.waitFor(() => expect(dependencies.upload).toHaveBeenCalledTimes(1))
  expect((await post(app, { ...request, runId: 'run-2' })).status).toBe(429)
  gate.resolve(fixtureCid)
  await vi.waitFor(() => expect(dependencies.store.get(request.runId)?.evidenceURI).toBe(fixtureCid))
})

test('an understated Content-Length cannot bypass the actual body limit', async () => {
  const dependencies = httpDeps(), app = createApp(dependencies)
  const response = await app.request('/runs', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-length': '1' },
    body: 'x'.repeat(500_000) })
  expect(response.status).toBe(413)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
})

test('an initial post-rename flush failure returns 503 rather than acknowledging durable admission', async () => {
  const dependencies = httpDeps(), app = createApp(dependencies), original = fs.fsyncSync
  let failed = false
  const sync = vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
    if (!failed && fs.fstatSync(fd).isDirectory()) { failed = true; throw Error('Initial directory flush failed') }
    original(fd)
  })
  const response = await post(app)
  sync.mockRestore()
  expect(response.status).toBe(503)
  expect((await app.request('/healthz')).status).toBe(503)
  expect(dependencies.llm.step).not.toHaveBeenCalled()
  expect(dependencies.budget.used()).toBe(0)
})

test('recovery from a first-write failure retains identity so an identical retry remains idempotent after restart', async () => {
  const dependencies = httpDeps(), base = dependencies.store
  let failed = false
  const store = { ...base, save: ((status, metadata) => {
    if (!failed) { failed = true; throw Error('Initial write failed') }
    base.save(status, metadata)
  }) as typeof base.save }
  const app = createApp({ ...dependencies, store })
  expect((await post(app)).status).toBe(503)
  await vi.waitFor(() => expect(base.get(request.runId)?.state).toBe('done'))
  expect(base.recovery(request.runId)).toBeDefined()
  const restarted = createApp({ ...dependencies, store: createStore(dependencies.env.RUN_DIR) })
  expect((await post(restarted)).status).toBe(202)
  expect(WorkerRunStatus.parse((await statusOf(restarted)).body).result?.status).toBe('INCOMPLETE')
  expect(dependencies.llm.step).not.toHaveBeenCalled()
})
