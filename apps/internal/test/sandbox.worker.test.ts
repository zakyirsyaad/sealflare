import { expect, test } from 'vitest'
import type { SandboxResult, WorkerRunStatus } from '@sealflare/shared/schemas'
import { pollOnce, type PollerDeps } from '../src/sandbox/poller'
import { body, createTestDb, get, post } from './helpers'
import {
  NOW,
  bundle,
  cleanResult,
  fakeWorker,
  hashOf,
  sandboxFixture,
  signedRequest,
} from './sandbox.helpers'

const entries = bundle()
const BUNDLE_HASH = hashOf(entries)

type RunAnswer = { success: true; data: { runId: string; status: string; quotaLeft: number } }
type ErrorAnswer = { success: false; error: { code: string; message: string } }

/** The result of a run that ended without a verdict. */
function incomplete(bundleHash: string): SandboxResult {
  return {
    schemaVersion: 1,
    bundleHash: bundleHash as `0x${string}`,
    probeSetVersion: 'v1',
    modelId: 'model-1',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: 'INCOMPLETE',
    probes: [],
  }
}

/** The answer of a worker whose run ended. */
function doneStatus(runId: string, cause?: 'infrastructure' | 'skill_content'): WorkerRunStatus {
  return {
    runId,
    state: 'done',
    probes: [],
    result: incomplete(BUNDLE_HASH),
    ...(cause === undefined ? {} : { failure: { cause, message: 'The run did not finish.' } }),
  }
}

/** The runs of the queue, read from the database. */
async function runs(db: { query: <T>(text: string, params?: readonly unknown[]) => Promise<T[]> }): Promise<
  { run_id: string; status: string; failure_cause: string | null; result: unknown }[]
> {
  return db.query('SELECT run_id, status, failure_cause, result FROM sandbox_runs ORDER BY created_at')
}

/** The quota of the address, read from the database. */
async function used(db: { query: <T>(text: string, params?: readonly unknown[]) => Promise<T[]> }): Promise<number> {
  const rows = await db.query<{ used: number }>('SELECT used FROM sandbox_quota')
  return rows[0]?.used ?? 0
}

/** The queue of a test. */
function poller(db: Parameters<typeof pollOnce>[0]['sql'], worker: PollerDeps['worker']): PollerDeps {
  return { sql: db, now: () => NOW, probeSetVersion: 'v1', modelId: 'model-1', worker }
}

test('quota comes back for an infrastructure failure and not for a skill_content failure', async () => {
  const { db, close } = await createTestDb()
  let cause: 'infrastructure' | 'skill_content' = 'infrastructure'
  const worker = fakeWorker({ answer: (runId) => doneStatus(runId, cause) })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '1' }))
  expect(await used(db)).toBe(1)

  await pollOnce(poller(db, worker))
  await pollOnce(poller(db, worker))
  const afterInfrastructure = await runs(db)
  expect(afterInfrastructure[0]?.status).toBe('incomplete')
  expect(afterInfrastructure[0]?.failure_cause).toBe('infrastructure')
  expect(await used(db)).toBe(0)

  cause = 'skill_content'
  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '2' }))
  expect(await used(db)).toBe(1)

  await pollOnce(poller(db, worker))
  await pollOnce(poller(db, worker))
  const afterSkillContent = await runs(db)
  expect(afterSkillContent[1]?.status).toBe('incomplete')
  expect(afterSkillContent[1]?.failure_cause).toBe('skill_content')
  expect(await used(db)).toBe(1)
  await close()
})

test('a violation seen in a poll is stored before the run ends, and survives the worker disappearing', async () => {
  const { db, close } = await createTestDb()
  const violation = {
    probeId: 'indirect_injection' as const,
    runs: [
      {
        index: 0 as const,
        outcome: 'violation' as const,
        violations: [{ tool: 'transfer', args: { to: '0x0' }, rule: 'no-transfer' }],
      },
    ],
  }
  const running = fakeWorker({
    answer: (runId) => ({ runId, state: 'running', currentProbe: 'indirect_injection', probes: [violation] }),
  })
  const { app } = sandboxFixture(db, { worker: running })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, running))
  await pollOnce(poller(db, running))

  const stored = await db.query<{ probes: unknown }>('SELECT probes FROM sandbox_runs')
  expect(JSON.stringify(stored[0]?.probes)).toContain('no-transfer')

  const cached = await db.query<{ status: string }>('SELECT status FROM sandbox_cache')
  expect(cached).toHaveLength(1)
  expect(cached[0]?.status).toBe('SANDBOX_FUZZ_FAILED')

  const gone = fakeWorker({ unreachable: true })
  await pollOnce(poller(db, gone))

  const afterFailure = await runs(db)
  expect(afterFailure[0]?.status).toBe('incomplete')
  const result = afterFailure[0]?.result as SandboxResult
  expect(result.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.probes[0]?.runs[0]?.violations[0]?.rule).toBe('no-transfer')

  const cacheAfterFailure = await db.query<{ status: string }>('SELECT status FROM sandbox_cache')
  expect(cacheAfterFailure[0]?.status).toBe('SANDBOX_FUZZ_FAILED')

  // The API still shows what was caught, so a run that ended early never hides a violation.
  const shown = await db.query<{ run_id: string }>('SELECT run_id FROM sandbox_runs')
  const state = (await body<{ data: { status: string; result?: SandboxResult } }>(
    await get(app, `/sandbox/runs/${shown[0]?.run_id}`),
  )).data
  expect(state.status).toBe('incomplete')
  expect(state.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  await close()
})

test('worker 429 DAILY_LIMIT becomes SANDBOX_PAUSED and the quota is returned', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ refuse: 'DAILY_LIMIT' })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(await used(db)).toBe(1)

  await pollOnce(poller(db, worker))
  expect(await used(db)).toBe(0)
  const pauses = await db.query('SELECT * FROM sandbox_pause')
  expect(pauses).toHaveLength(1)

  const next = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '2' }))
  expect(next.status).toBe(429)
  expect((await body<ErrorAnswer>(next)).error.code).toBe('SANDBOX_PAUSED')
  expect(await used(db)).toBe(0)
  await close()
})

test('a worker that is busy leaves the run in the queue and keeps the slot of the quota', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ refuse: 'BUSY' })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  const queued = await runs(db)
  expect(queued[0]?.status).toBe('queued')
  expect(await used(db)).toBe(1)
  await close()
})

test('a run that the worker finished cleanly is stored and the quota is not given back', async () => {
  const { db, close } = await createTestDb()
  const clean = fakeWorker({
    answer: (runId) => ({ runId, state: 'done', probes: [], result: cleanResult(BUNDLE_HASH) }),
  })
  const { app } = sandboxFixture(db, { worker: clean })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, clean))
  await pollOnce(poller(db, clean))

  const finished = await runs(db)
  expect(finished[0]?.status).toBe('done')
  expect(await used(db)).toBe(1)
  await close()
})

test('the worker is asked for the run of the queue, one run at a time', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ answer: (runId) => ({ runId, state: 'running', probes: [] }) })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '1' }))
  const second = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '2' }))
  const secondRun = (await body<RunAnswer>(second)).data

  await pollOnce(poller(db, worker))
  expect(worker.started).toHaveLength(1)

  await pollOnce(poller(db, worker))
  expect(worker.started).toHaveLength(1)

  const running = await db.query<{ run_id: string }>("SELECT * FROM sandbox_runs WHERE status = 'running'")
  expect(running).toHaveLength(1)
  expect(running[0]?.run_id).not.toBe(secondRun.runId)
  await close()
})
