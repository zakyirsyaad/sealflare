// APIs checked 2026-11-25:
// https://hono.dev/docs/api/hono#request
// https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { CONSTANTS } from '@sealflare/shared/rules'
import { PROBE_IDS, WorkerRunResponse, WorkerRunStatus, type WorkerRunRequest } from '@sealflare/shared/schemas'
import type { Env } from './env'
import type { LlmClient } from './llm'
import { BudgetStorageError, type Budget } from './budget'
import { RunId, type RunStore } from './store'
import { requestDigest, type RecoveryInfo } from './runIdentity'
import { interrupted, recoverStore } from './recovery'
import { runProbeSet } from './runner'
import { readRunRequest, RequestError } from './httpBody'

type Dependencies = { env: Env; llm: LlmClient; store: RunStore; budget: Budget; upload: (json: string) => Promise<string> }
type State = { busy: boolean; faulted: boolean; recoveryBlocked: boolean; started: boolean }
const digest = (value: string) => crypto.createHash('sha256').update(value).digest()
const refuse = (reason: 'BUSY' | 'DAILY_LIMIT' = 'BUSY') => Response.json(WorkerRunResponse.parse({ accepted: false, reason }), { status: 429 })

function monitorBudget(budget: Budget, state: State): Budget {
  const guard = <T>(operation: () => T): T => {
    try { return operation() }
    catch (error) { if (error instanceof BudgetStorageError) state.faulted = true; throw error }
  }
  return { canTake: (count) => guard(() => budget.canTake(count)), tryTake: (count) => guard(() => budget.tryTake(count)),
    used: () => guard(() => budget.used()) }
}

async function performRun(request: WorkerRunRequest, deps: Dependencies, state: State): Promise<void> {
  let latest: WorkerRunStatus | undefined, metadata: RecoveryInfo | undefined
  const tracked: RunStore = { ...deps.store, save: (status, identity) => {
    latest = WorkerRunStatus.parse(status)
    if (identity) metadata = identity
    try { deps.store.save(status, identity) }
    catch (error) { state.faulted = true; throw error }
    if (identity) state.started = true
  } }
  try {
    const completed = await runProbeSet(request, { ...deps, store: tracked })
    let uri: string
    try {
      uri = await deps.upload(JSON.stringify(completed.result))
      if (!/^ipfs:\/\/[A-Za-z0-9]+$/.test(uri) || uri.length > 2048) return
    } catch { return } // Keep the already durable result when evidence hosting is unavailable.
    tracked.save({ ...completed, evidenceURI: uri })
  } catch {
    try {
      const progress = latest ?? deps.store.get(request.runId), identity = metadata ?? deps.store.recovery(request.runId)
      if (!progress || !identity) throw Error('Run state could not be recovered.')
      if (progress.state === 'running') tracked.save(interrupted(progress, identity), identity)
    } catch { /* Preserve the last snapshot and any storage fault; never erase evidence. */ }
  }
}

function admit(request: WorkerRunRequest, deps: Dependencies, state: State): Response {
  if (state.faulted) return refuse()
  const existing = deps.store.get(request.runId)
  if (existing) {
    const same = deps.store.recovery(request.runId)?.requestDigest === requestDigest(request)
    return same ? Response.json(WorkerRunResponse.parse({ accepted: true }), { status: 202 }) : refuse()
  }
  if (state.busy) return refuse()
  if (!deps.budget.canTake(PROBE_IDS.length * CONSTANTS.PROBE_RUNS)) return refuse('DAILY_LIMIT')
  state.busy = true; state.started = false
  void performRun(request, deps, state).then(() => { state.busy = false }, () => { state.faulted = true; state.busy = false })
  if (!state.started) {
    return refuse()
  }
  return Response.json(WorkerRunResponse.parse({ accepted: true }), { status: 202 })
}

export function createApp(deps: Dependencies): Hono {
  const recovery = recoverStore(deps.store)
  const app = new Hono(), state: State = { busy: false, faulted: false,
    recoveryBlocked: recovery.blockedLegacyRuns > 0, started: false }, expected = digest(deps.env.WORKER_BEARER_KEY)
  const monitored = { ...deps, budget: monitorBudget(deps.budget, state) }
  app.onError((_error, c) => c.req.method === 'POST' ? refuse() : c.json({ error: 'Worker is unavailable.' }, 503))
  app.get('/healthz', (c) => {
    const healthy = !state.faulted && !state.recoveryBlocked
    return c.json({ healthy }, healthy ? 200 : 503)
  })
  app.use('*', async (c, next) => {
    const token = /^Bearer ([!-~]{1,4096})$/.exec(c.req.header('authorization') ?? '')?.[1] ?? ''
    if (!crypto.timingSafeEqual(expected, digest(token))) return c.json({ error: 'Unauthorized.' }, 401)
    return next()
  })
  app.post('/runs', async (c) => {
    try { return admit(await readRunRequest(c.req.raw), monitored, state) }
    catch (error) {
      if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
      throw error
    }
  })
  app.get('/runs/:id', (c) => {
    const id = RunId.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'Invalid run ID.' }, 400)
    const status = deps.store.get(id.data)
    return status ? c.json(WorkerRunStatus.parse(status)) : c.json({ error: 'Run was not found.' }, 404)
  })
  return app
}
