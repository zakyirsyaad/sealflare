import { expect, test } from 'vitest'
import { CONSTANTS } from '@sealflare/shared/rules'
import type { SandboxResult } from '@sealflare/shared/schemas'
import { cachePut } from '../src/sandbox/cache'
import { pollOnce } from '../src/sandbox/poller'
import { body, createTestDb, get, post } from './helpers'
import {
  ADDRESS,
  NOW,
  NOW_SECONDS,
  OTHER_ADDRESS,
  SKILL_TEXT,
  SRC,
  bundle,
  cleanResult,
  failedResult,
  fakeWorker,
  hashOf,
  sandboxFixture,
  signedRequest,
} from './sandbox.helpers'

type RunAnswer = { success: true; data: { runId: string; status: string; queuePosition: number; quotaLeft: number } }
type ErrorAnswer = { success: false; error: { code: string; message: string } }
type StatusAnswer = {
  success: true
  data: { runId: string; status: string; queuePosition?: number; result?: SandboxResult }
}

const entries = bundle()
const BUNDLE_HASH = hashOf(entries)

test('a cached failed result is returned without using quota or calling the worker', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker()
  const { app } = sandboxFixture(db, { worker })
  await cachePut({ sql: db }, failedResult(BUNDLE_HASH))

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(created.status).toBe(200)
  const run = (await body<RunAnswer>(created)).data
  expect(run.quotaLeft).toBe(CONSTANTS.SANDBOX_DAILY_RUNS)

  await pollOnce({
    sql: db,
    now: () => NOW,
    probeSetVersion: 'v1',
    modelId: 'model-1',
    worker,
  })

  const status = await get(app, `/sandbox/runs/${run.runId}`)
  const state = (await body<StatusAnswer>(status)).data
  expect(state.status).toBe('done')
  expect(state.result?.status).toBe('SANDBOX_FUZZ_FAILED')

  const quota = await db.query('SELECT * FROM sandbox_quota')
  expect(quota).toHaveLength(0)
  expect(worker.started).toHaveLength(0)
  await close()
})

test('a cached clean result is used while the model and the probe set version are the same', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker()
  const { app } = sandboxFixture(db, { worker })
  await cachePut({ sql: db }, cleanResult(BUNDLE_HASH))

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect((await body<RunAnswer>(created)).data.quotaLeft).toBe(CONSTANTS.SANDBOX_DAILY_RUNS)

  const quota = await db.query('SELECT * FROM sandbox_quota')
  expect(quota).toHaveLength(0)
  expect(worker.started).toHaveLength(0)
  await close()
})

test('a cached clean result is ignored when the model or the probe set version differs', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker()
  const { app } = sandboxFixture(db, { worker, modelId: 'model-2' })
  await cachePut({ sql: db }, cleanResult(BUNDLE_HASH, { modelId: 'model-1' }))

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(created.status).toBe(200)
  expect((await body<RunAnswer>(created)).data.quotaLeft).toBe(CONSTANTS.SANDBOX_DAILY_RUNS - 1)

  const quota = await db.query<{ used: number }>('SELECT used FROM sandbox_quota')
  expect(quota[0]?.used).toBe(1)
  await close()
})

test('quota is taken when the run is queued, and the sixth run in a UTC day is QUOTA_EXHAUSTED', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  for (let index = 0; index < CONSTANTS.SANDBOX_DAILY_RUNS; index += 1) {
    const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: String(index + 1) }))
    expect(created.status).toBe(200)
    expect((await body<RunAnswer>(created)).data.quotaLeft).toBe(CONSTANTS.SANDBOX_DAILY_RUNS - index - 1)
  }

  const sixth = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '6' }))
  expect(sixth.status).toBe(429)
  expect((await body<ErrorAnswer>(sixth)).error.code).toBe('QUOTA_EXHAUSTED')

  const quota = await db.query<{ used: number }>('SELECT used FROM sandbox_quota')
  expect(quota[0]?.used).toBe(CONSTANTS.SANDBOX_DAILY_RUNS)
  const runs = await db.query('SELECT * FROM sandbox_runs')
  expect(runs).toHaveLength(CONSTANTS.SANDBOX_DAILY_RUNS)
  await close()
})

test('the internal service re-verifies the signature and the Agent ID even with a valid inter-service key', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db, { signer: OTHER_ADDRESS as `0x${string}` })

  const wrongSigner = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(wrongSigner.status).toBe(400)
  expect((await body<ErrorAnswer>(wrongSigner)).error.code).toBe('SIGNATURE_INVALID')

  const { app: withoutAgentId } = sandboxFixture(db, { holder: false })
  const noAgentId = await post(withoutAgentId, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(noAgentId.status).toBe(403)
  expect((await body<ErrorAnswer>(noAgentId)).error.code).toBe('NOT_AGENT_ID_HOLDER')

  const runs = await db.query('SELECT * FROM sandbox_runs')
  expect(runs).toHaveLength(0)
  await close()
})

test('an expired request is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  const expired = await post(
    app,
    '/sandbox/runs',
    signedRequest({ bundleHash: BUNDLE_HASH, expiry: NOW_SECONDS - 1 }),
  )
  expect(expired.status).toBe(400)
  expect((await body<ErrorAnswer>(expired)).error.code).toBe('SIGNATURE_EXPIRED')
  await close()
})

test('a replayed nonce is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)
  const request = signedRequest({ bundleHash: BUNDLE_HASH })

  const first = await post(app, '/sandbox/runs', request)
  expect(first.status).toBe(200)

  const replay = await post(app, '/sandbox/runs', request)
  expect(replay.status).toBe(400)
  expect((await body<ErrorAnswer>(replay)).error.code).toBe('SIGNATURE_INVALID')

  const runs = await db.query('SELECT * FROM sandbox_runs')
  expect(runs).toHaveLength(1)
  await close()
})

test('a request that was refused before the queue gives its nonce back', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  const accepted = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '88' }))
  expect(accepted.status).toBe(200)

  // The bundle of this request is not the bundle the source holds, so the request is refused
  // before it reaches the queue and its nonce is given back.
  const wrongHash = hashOf(bundle('# Another skill\n'))
  const refused = await post(app, '/sandbox/runs', signedRequest({ bundleHash: wrongHash, nonce: '89' }))
  expect(refused.status).toBe(400)

  const rows = await db.query<{ state: string; nonce: string }>('SELECT state, nonce FROM nonces ORDER BY nonce')
  expect(rows.map(row => `${row.nonce}:${row.state}`)).toEqual(['88:spent'])
  await close()
})

test('the queue runs one job at a time and reports queue position', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker()
  const { app } = sandboxFixture(db, { worker })

  const first = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '1' }))
  const second = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, nonce: '2' }))
  const firstRun = (await body<RunAnswer>(first)).data
  const secondRun = (await body<RunAnswer>(second)).data
  expect(firstRun.queuePosition).toBe(1)
  expect(secondRun.queuePosition).toBe(2)

  await pollOnce({ sql: db, now: () => NOW, probeSetVersion: 'v1', modelId: 'model-1', worker })

  const running = await db.query("SELECT * FROM sandbox_runs WHERE status = 'running'")
  expect(running).toHaveLength(1)
  expect(worker.started).toHaveLength(1)

  const state = (await body<StatusAnswer>(await get(app, `/sandbox/runs/${secondRun.runId}`))).data
  expect(state.status).toBe('queued')
  expect(state.queuePosition).toBe(1)
  await close()
})

test('SKILL.md for the worker is fetched from the pinned commit in src, never taken from the client', async () => {
  const { db, close } = await createTestDb()
  const worker = fakeWorker()
  const { app, fetcher } = sandboxFixture(db, { worker })

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  const runId = (await body<RunAnswer>(created)).data.runId

  expect(fetcher.asked).toHaveLength(1)
  expect(fetcher.asked[0]).toEqual({ owner: 'sealflare', repo: 'demo', commit: 'a'.repeat(40), path: 'skills/demo' })

  await pollOnce({ sql: db, now: () => NOW, probeSetVersion: 'v1', modelId: 'model-1', worker })
  expect(worker.requests).toHaveLength(1)
  expect(worker.requests[0]?.runId).toBe(runId)
  expect(worker.requests[0]?.skillMd).toBe(SKILL_TEXT)
  await close()
})

test('a skill that is not the bundle the client signed is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db, { entries: bundle('# Another skill\n') })

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(created.status).toBe(400)
  expect((await body<ErrorAnswer>(created)).error.code).toBe('BAD_REQUEST')

  const runs = await db.query('SELECT * FROM sandbox_runs')
  expect(runs).toHaveLength(0)
  await close()
})

test('a run without a GitHub token is refused and takes no quota', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db, { token: null })

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  expect(created.status).toBe(400)
  expect((await body<ErrorAnswer>(created)).error.code).toBe('BAD_REQUEST')

  const runs = await db.query('SELECT * FROM sandbox_runs')
  expect(runs).toHaveLength(0)
  const quota = await db.query('SELECT * FROM sandbox_quota')
  expect(quota).toHaveLength(0)
  await close()
})

test('a source that does not name a skill is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH, src: ADDRESS }))
  expect(created.status).toBe(400)
  expect((await body<ErrorAnswer>(created)).error.code).toBe('BAD_REQUEST')
  await close()
})

test('the quota of an address is reported, and it resets at midnight UTC', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  const quota = await get(app, `/sandbox/quota/${ADDRESS}`)

  expect(quota.status).toBe(200)
  const answer = (await body<{ success: true; data: { left: number; limit: number; resetsAt: string } }>(quota)).data
  expect(answer.left).toBe(CONSTANTS.SANDBOX_DAILY_RUNS - 1)
  expect(answer.limit).toBe(CONSTANTS.SANDBOX_DAILY_RUNS)
  expect(answer.resetsAt).toBe('2026-11-27T00:00:00.000Z')
  await close()
})

test('a run that does not exist is RUN_NOT_FOUND', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  const response = await get(app, '/sandbox/runs/run_0123456789abcdef01234567')
  expect(response.status).toBe(404)
  expect((await body<ErrorAnswer>(response)).error.code).toBe('RUN_NOT_FOUND')
  await close()
})

test('the source of the run is kept with the run', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  const runs = await db.query<{ src: string; skill_md: string }>('SELECT src, skill_md FROM sandbox_runs')
  expect(runs[0]?.src).toBe(SRC)
  expect(runs[0]?.skill_md).toBe(SKILL_TEXT)
  await close()
})

test('a stored result that contradicts its own probes is not a result', async () => {
  const { db, close } = await createTestDb()
  const { app } = sandboxFixture(db)

  const created = await post(app, '/sandbox/runs', signedRequest({ bundleHash: BUNDLE_HASH }))
  const run = (await body<RunAnswer>(created)).data
  // A result that says "clean" while one of its probes caught a violation must never be shown.
  const forged = { ...failedResult(BUNDLE_HASH), status: 'NO_VIOLATION_OBSERVED' }
  await db.query(`UPDATE sandbox_runs SET status = 'done', result = $2 WHERE run_id = $1`, [
    run.runId,
    JSON.stringify(forged),
  ])
  const state = (await body<StatusAnswer>(await get(app, `/sandbox/runs/${run.runId}`))).data
  expect(state.status).toBe('done')
  expect(state.result).toBeUndefined()
  await close()
})
