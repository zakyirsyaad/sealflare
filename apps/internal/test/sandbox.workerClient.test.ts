import { expect, test } from 'vitest'
import { Hono } from 'hono'
import type { WorkerRunRequest, WorkerRunStatus } from '@sealflare/shared/schemas'
import {
  createWorkerClient,
  WorkerRefused,
  WorkerRejected,
  WorkerUnavailable,
} from '../src/sandbox/workerClient'

/**
 * The probe set version of the real worker.
 *
 * The worker refuses a run whose probe set version is not its own, so the value has to be the one
 * of `packages/sandbox-worker/src/probes/version.ts`. The internal service takes it from the
 * environment, because the worker is another lane's package.
 */
const PROBE_SET_VERSION = 'v1-5b7afb275dd1bf5827eb568bb11b729f'

const WORKER_URL = 'http://worker.test'

/** A request the worker accepts. */
function request(overrides: Partial<WorkerRunRequest> = {}): WorkerRunRequest {
  return {
    runId: 'run_1',
    bundleHash: `0x${'ab'.repeat(32)}`,
    skillMd: '# Skill\n',
    probeSetVersion: PROBE_SET_VERSION,
    modelId: 'model-1',
    ...overrides,
  }
}

/**
 * The worker of the real one, with the same rules.
 *
 * The routes, the answers and the codes are the ones of `packages/sandbox-worker/src/server.ts`:
 * a run whose probe set version is not the worker's own is refused with 400, a busy worker
 * answers 429 with the reason, a new run is answered with 202, and an unknown run with 404.
 */
function workerApp(options: { busy?: boolean; dailyLimit?: boolean; healthy?: boolean; known?: WorkerRunStatus } = {}) {
  const app = new Hono()
  app.get('/healthz', c => c.json({ healthy: options.healthy ?? true }, (options.healthy ?? true) ? 200 : 503))
  app.post('/runs', async c => {
    const body = (await c.req.json()) as WorkerRunRequest
    if (body.probeSetVersion !== PROBE_SET_VERSION) {
      return c.json({ error: 'Unsupported probe set version.' }, 400)
    }
    if (options.dailyLimit === true) return c.json({ accepted: false, reason: 'DAILY_LIMIT' }, 429)
    if (options.busy === true) return c.json({ accepted: false, reason: 'BUSY' }, 429)
    return c.json({ accepted: true }, 202)
  })
  app.get('/runs/:id', c => {
    if (options.known === undefined) return c.json({ error: 'Run was not found.' }, 404)
    return c.json(options.known)
  })
  return app
}

/** The fetch that talks to the worker of a test. */
function fetchOf(app: Hono): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(new URL(String(input)), init)
    return app.fetch(request)
  }) as typeof fetch
}

/** The client of a worker of a test. */
function clientOf(app: Hono) {
  return createWorkerClient({ url: WORKER_URL, key: 'k'.repeat(32), fetch: fetchOf(app) })
}

test('the worker accepts a run and the client says nothing more', async () => {
  const client = clientOf(workerApp())
  await expect(client.start(request())).resolves.toBeUndefined()
})

test('a busy worker is a refusal with the reason of the worker', async () => {
  const client = clientOf(workerApp({ busy: true }))
  await expect(client.start(request())).rejects.toThrow(WorkerRefused)
  await client.start(request()).catch((error: unknown) => {
    expect(error).toBeInstanceOf(WorkerRefused)
    expect((error as WorkerRefused).reason).toBe('BUSY')
  })
})

test('the daily limit of the worker is a refusal with that reason', async () => {
  const client = clientOf(workerApp({ dailyLimit: true }))
  await client.start(request()).catch((error: unknown) => {
    expect(error).toBeInstanceOf(WorkerRefused)
    expect((error as WorkerRefused).reason).toBe('DAILY_LIMIT')
  })
})

test('a probe set version the worker does not run is refused, and it is not a busy worker', async () => {
  const client = clientOf(workerApp())
  await expect(client.start(request({ probeSetVersion: 'v1' }))).rejects.toThrow(WorkerRejected)
})

test('a run the worker does not know has no status', async () => {
  const client = clientOf(workerApp())
  await expect(client.status('run_1')).resolves.toBeNull()
})

test('the status of a known run is read', async () => {
  const known: WorkerRunStatus = {
    runId: 'run_1',
    state: 'running',
    currentProbe: 'indirect_injection',
    probes: [],
  }
  const client = clientOf(workerApp({ known }))
  await expect(client.status('run_1')).resolves.toEqual(known)
})

test('a healthy worker is healthy and a worker that faulted is not', async () => {
  await expect(clientOf(workerApp()).health()).resolves.toBe(true)
  await expect(clientOf(workerApp({ healthy: false })).health()).resolves.toBe(false)
})

test('a worker that cannot be reached is not healthy and cannot start a run', async () => {
  const client = createWorkerClient({
    url: WORKER_URL,
    key: 'k'.repeat(32),
    fetch: (() => Promise.reject(new Error('no connection'))) as unknown as typeof fetch,
  })
  await expect(client.health()).rejects.toThrow(WorkerUnavailable)
  await expect(client.start(request())).rejects.toThrow(WorkerUnavailable)
})
