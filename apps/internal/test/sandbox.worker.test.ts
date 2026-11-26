import { expect, test } from 'vitest'
import type { ProbeResult, SandboxResult, WorkerRunStatus } from '@sealflare/shared/schemas'
import { PROBE_IDS } from '@sealflare/shared/schemas'
import { pollOnce, runQueue, type PollerDeps } from '../src/sandbox/poller'
import { body, createTestDb, get, post } from './helpers'
import {
  NOW,
  bundle,
  cleanResult,
  failedResult,
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
  return db.query('SELECT run_id, status, failure_cause, result FROM sandbox_runs ORDER BY seq')
}

/** The quota of the address, read from the database. */
async function used(db: { query: <T>(text: string, params?: readonly unknown[]) => Promise<T[]> }): Promise<number> {
  const rows = await db.query<{ used: number }>('SELECT used FROM sandbox_quota')
  return rows[0]?.used ?? 0
}

/** The queue of a test. */
function poller(db: Parameters<typeof pollOnce>[0]['sql'], worker: PollerDeps['worker']): PollerDeps {
  return pollerAt(db, worker, () => NOW)
}

/** The queue of a test, with a clock the test moves itself. */
function pollerAt(
  db: Parameters<typeof pollOnce>[0]['sql'],
  worker: PollerDeps['worker'],
  now: () => Date,
): PollerDeps {
  return { sql: db, now, probeSetVersion: 'v1', modelId: 'model-1', worker }
}

/** The probe results of a run that made progress: the first probes are finished. */
function probesOf(count: number): ProbeResult[] {
  return PROBE_IDS.map((probeId, index): ProbeResult => ({
    probeId,
    runs:
      index < count
        ? ([0, 1, 2] as const).map(runIndex => ({ index: runIndex, outcome: 'clean' as const, violations: [] }))
        : [],
  }))
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
  // A worker that is restarting answers nothing for a moment, so a few failed reads in a row are
  // allowed before the run is failed.
  for (let attempt = 0; attempt < 3; attempt += 1) await pollOnce(poller(db, gone))

  const afterFailure = await runs(db)
  expect(afterFailure[0]?.status).toBe('incomplete')
  const result = afterFailure[0]?.result as SandboxResult
  expect(result.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.probes[0]?.runs[0]?.violations[0]?.rule).toBe('no-transfer')

  // The run ended with a verdict about the skill, so it is not a failure of our infrastructure
  // and the slot of the quota does not come back.
  expect(afterFailure[0]?.failure_cause).toBeNull()
  expect(await used(db)).toBe(1)

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

test('a worker that is busy and not healthy ends the run and gives the quota back', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ refuse: 'BUSY', healthy: false })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(await used(db)).toBe(1)

  await pollOnce(poller(db, worker))

  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(failed[0]?.failure_cause).toBe('infrastructure')
  expect(await used(db)).toBe(0)
  await close()
})

test('a worker that is busy and healthy leaves the run in the queue', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ refuse: 'BUSY', healthy: true })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  const queued = await runs(db)
  expect(queued[0]?.status).toBe('queued')
  expect(await used(db)).toBe(1)
  await close()
})

test('a run that waits longer than it may wait ends and gives the quota back', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ refuse: 'BUSY', healthy: true })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  // The first refusal of the worker starts the wait. A run that waits behind a run of ours has
  // not waited for the worker at all, so the wait is measured from the refusal.
  await pollOnce(poller(db, worker))
  const later = new Date(NOW.getTime() + 31 * 60_000)
  await pollOnce(pollerAt(db, worker, () => later))

  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(failed[0]?.failure_cause).toBe('infrastructure')
  expect(await used(db)).toBe(0)
  await close()
})

test('a run that takes longer than it may take ends, and its slot comes back when the run really ends', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ answer: (runId) => ({ runId, state: 'running', probes: [] }) })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  const later = new Date(NOW.getTime() + 21 * 60_000)
  await pollOnce(pollerAt(db, worker, () => later))

  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(failed[0]?.failure_cause).toBe('infrastructure')
  // The worker may still be going with the run, so the slot is not given back yet. A run that
  // ends with a verdict about the skill keeps its slot, so the slot can only come back when the
  // run ends without one.
  expect(await used(db)).toBe(1)

  const muchLater = new Date(NOW.getTime() + 42 * 60_000)
  await pollOnce(pollerAt(db, worker, () => muchLater))

  expect(await used(db)).toBe(0)
  await close()
})

test('a run that keeps moving is never failed by the deadline', async () => {
  const { db, close } = await createTestDb()
  let reads = 0
  const worker = fakeWorker({
    answer: runId => {
      reads += 1
      return { runId, state: 'running', currentProbe: PROBE_IDS[0], probes: probesOf(reads) }
    },
  })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  // The run keeps showing new probe runs, so the deadline never applies to it.
  const later = new Date(NOW.getTime() + 25 * 60_000)
  await pollOnce(pollerAt(db, worker, () => later))
  const evenLater = new Date(NOW.getTime() + 45 * 60_000)
  await pollOnce(pollerAt(db, worker, () => evenLater))

  const moving = await runs(db)
  expect(moving[0]?.status).toBe('running')
  expect(await used(db)).toBe(1)
  await close()
})

test('a run that failed its deadline is still read, and a violation at the end reaches the cache', async () => {
  const { db, close } = await createTestDb()
  const violation: ProbeResult = {
    probeId: 'indirect_injection',
    runs: [
      { index: 0, outcome: 'violation', violations: [{ tool: 'transfer', args: { to: '0x0' }, rule: 'no-transfer' }] },
    ],
  }
  let reads = 0
  const worker = fakeWorker({
    answer: runId => {
      reads += 1
      if (reads === 1) return { runId, state: 'running', probes: [] }
      return { runId, state: 'done', probes: [violation], result: failedResult(BUNDLE_HASH) }
    },
  })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  // The run stops moving, so it fails its deadline. Its slot is not given back yet, because the
  // worker may still be going with it.
  const later = new Date(NOW.getTime() + 21 * 60_000)
  await pollOnce(pollerAt(db, worker, () => later))
  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(failed[0]?.failure_cause).toBe('infrastructure')
  expect(await used(db)).toBe(1)

  // The worker is still going with it, so it is read again. A violation it finds now is kept.
  await pollOnce(pollerAt(db, worker, () => later))
  const ended = await runs(db)
  expect(ended[0]?.status).toBe('incomplete')
  const result = ended[0]?.result as SandboxResult
  expect(result.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.probes[0]?.runs[0]?.violations[0]?.rule).toBe('no-transfer')

  // The run ended with a verdict about the skill, so it is not a failure of our infrastructure
  // any more and its slot does not come back.
  expect(ended[0]?.failure_cause).toBeNull()
  expect(await used(db)).toBe(1)

  const cached = await db.query<{ status: string }>('SELECT status FROM sandbox_cache')
  expect(cached).toHaveLength(1)
  expect(cached[0]?.status).toBe('SANDBOX_FUZZ_FAILED')
  await close()
})

test('the quota of a failed run comes back only once', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ unreachable: true })
  const { app } = sandboxFixture(db, { worker })

  // Two slots of the same address, so a second refund of the first run would show: the count
  // would go below one instead of staying at one.
  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '1' }))
  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '2' }))
  expect(await used(db)).toBe(2)

  await pollOnce(poller(db, worker))
  for (let attempt = 0; attempt < 3; attempt += 1) await pollOnce(poller(db, worker))

  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(await used(db)).toBe(1)

  // The run is read again and again, but the slot of the quota comes back only once.
  await pollOnce(poller(db, worker))
  await pollOnce(poller(db, worker))
  expect(await used(db)).toBe(1)
  await close()
})

test('the queue waits for every pass before it starts the next one', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker({ answer: runId => ({ runId, state: 'running', probes: [] }) })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))

  let passes = 0
  const waits: string[] = []
  await runQueue(poller(db, worker), {
    intervalMs: 0,
    sleep: async () => {
      waits.push('wait')
      passes += 1
    },
    isStopped: () => passes >= 2,
  })

  // Every pass is over before the next one starts, so two passes never read the same run.
  expect(waits).toEqual(['wait', 'wait'])
  expect(worker.started).toHaveLength(1)
  expect(worker.answered).toHaveLength(1)
  await close()
})

test('a run that is done without a transcript is followed until the transcript shows up', async () => {
  const { db, close } = await createTestDb()
  let reads = 0
  const worker = fakeWorker({
    answer: (runId) => {
      reads += 1
      const result = cleanResult(BUNDLE_HASH)
      return reads <= 1
        ? { runId, state: 'done', probes: result.probes, result }
        : { runId, state: 'done', probes: result.probes, result, evidenceURI: 'ipfs://bafkreitest' }
    },
  })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))

  // The run is done, but the worker uploads the transcript after the run itself.
  await pollOnce(poller(db, worker))
  const waiting = await db.query<{ status: string; evidence_uri: string | null }>(
    'SELECT status, evidence_uri FROM sandbox_runs',
  )
  expect(waiting[0]?.status).toBe('done')
  expect(waiting[0]?.evidence_uri).toBeNull()

  await pollOnce(poller(db, worker))
  const finished = await db.query<{ status: string; evidence_uri: string | null }>(
    'SELECT status, evidence_uri FROM sandbox_runs',
  )
  expect(finished[0]?.status).toBe('done')
  expect(finished[0]?.evidence_uri).toBe('ipfs://bafkreitest')
  await close()
})

test('a run that ends badly is never shown as a clean run', async () => {
  const { db, close } = await createTestDb()
  const clean = cleanResult(BUNDLE_HASH)
  const worker = fakeWorker({
    answer: (runId) => ({ runId, state: 'running', probes: clean.probes }),
  })
  const { app } = sandboxFixture(db, { worker })

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  await pollOnce(poller(db, worker))
  await pollOnce(poller(db, worker))

  const gone = fakeWorker({ unreachable: true })
  for (let attempt = 0; attempt < 3; attempt += 1) await pollOnce(poller(db, gone))

  const failed = await runs(db)
  expect(failed[0]?.status).toBe('incomplete')
  expect(failed[0]?.result).toBeNull()

  // The run ended without a verdict, so it failed for a reason of ours and the slot of the quota
  // comes back.
  expect(failed[0]?.failure_cause).toBe('infrastructure')
  expect(await used(db)).toBe(0)

  const cached = await db.query<{ status: string }>('SELECT status FROM sandbox_cache')
  expect(cached).toHaveLength(0)
  await close()
})
