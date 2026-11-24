// APIs checked 2026-11-25:
// https://hono.dev/docs/api/hono#request
// https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { WorkerRunResponse, WorkerRunStatus, type WorkerRunRequest } from '@sealflare/shared/schemas'
import type { Env } from './env'
import type { LlmClient } from './llm'
import type { Budget } from './budget'
import { RunId, type RunStore } from './store'
import { requestDigest, type RecoveryInfo } from './runIdentity'
import { interrupted, recoverStore } from './recovery'
import { runProbeSet } from './runner'
import { readRunRequest, RequestError } from './httpBody'

type Dependencies = { env: Env; llm: LlmClient; store: RunStore; budget: Budget; upload: (json: string) => Promise<string> }
type State = { busy: boolean; faulted: boolean }
const digest = (value: string) => crypto.createHash('sha256').update(value).digest()

async function performRun(request: WorkerRunRequest, deps: Dependencies, state: State): Promise<void> {
  let latest: WorkerRunStatus | undefined, metadata: RecoveryInfo | undefined
  const tracked: RunStore = { ...deps.store, save: (status, identity) => {
    latest = WorkerRunStatus.parse(status)
    if (identity) metadata = identity
    deps.store.save(status, identity)
  } }
  try {
    const completed = await runProbeSet(request, { ...deps, store: tracked })
    let uri: string
    try {
      uri = await deps.upload(JSON.stringify(completed.result))
      if (!/^ipfs:\/\/[A-Za-z0-9]+$/.test(uri) || uri.length > 2048) return
    } catch { return } // Keep the already durable result when evidence hosting is unavailable.
    deps.store.save({ ...completed, evidenceURI: uri })
  } catch {
    state.faulted = true
    try {
      const progress = latest ?? deps.store.get(request.runId), identity = metadata ?? deps.store.recovery(request.runId)
      if (!progress || !identity) throw Error('Run state could not be recovered.')
      if (progress.state === 'running') deps.store.save(interrupted(progress, identity))
    } catch { /* Leave the worker faulted; never replace caught evidence with older progress. */ }
  }
}

function admit(request: WorkerRunRequest, deps: Dependencies, state: State): Response {
  if (state.faulted) return Response.json({ error: 'Worker storage is unavailable.' }, { status: 503 })
  const existing = deps.store.get(request.runId)
  if (existing) {
    const same = deps.store.recovery(request.runId)?.requestDigest === requestDigest(request)
    return Response.json(same ? WorkerRunResponse.parse({ accepted: true }) : { error: 'Run ID is already bound.' }, { status: same ? 202 : 409 })
  }
  if (state.busy) return Response.json(WorkerRunResponse.parse({ accepted: false, reason: 'BUSY' }), { status: 429 })
  if (!deps.budget.canTake(1)) return Response.json(WorkerRunResponse.parse({ accepted: false, reason: 'DAILY_LIMIT' }), { status: 429 })
  state.busy = true
  void performRun(request, deps, state).then(() => { state.busy = false }, () => { state.faulted = true; state.busy = false })
  if (!deps.store.get(request.runId)) {
    state.faulted = true
    return Response.json({ error: 'Run could not be persisted.' }, { status: 503 })
  }
  return Response.json(WorkerRunResponse.parse({ accepted: true }), { status: 202 })
}

export function createApp(deps: Dependencies): Hono {
  recoverStore(deps.store)
  const app = new Hono(), state: State = { busy: false, faulted: false }, expected = digest(deps.env.WORKER_BEARER_KEY)
  app.onError((_error, c) => { state.faulted = true; return c.json({ error: 'Worker is unavailable.' }, 503) })
  app.get('/healthz', (c) => c.json({ healthy: !state.faulted }, state.faulted ? 503 : 200))
  app.use('*', async (c, next) => {
    const token = /^Bearer ([!-~]{1,4096})$/.exec(c.req.header('authorization') ?? '')?.[1] ?? ''
    if (!crypto.timingSafeEqual(expected, digest(token))) return c.json({ error: 'Unauthorized.' }, 401)
    return next()
  })
  app.post('/runs', async (c) => {
    try { return admit(await readRunRequest(c.req.raw), deps, state) }
    catch (error) {
      if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })
  app.get('/runs/:id', (c) => {
    if (state.faulted) return c.json({ error: 'Worker storage is unavailable.' }, 503)
    const id = RunId.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Invalid run ID.' }, 400)
    const status = deps.store.get(id.data)
    return status ? c.json(WorkerRunStatus.parse(status)) : c.json({ error: 'Run was not found.' }, 404)
  })
  return app
}
