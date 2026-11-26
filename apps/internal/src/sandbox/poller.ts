import type { Hex } from 'viem'
import { ProbeResult, deriveSandboxStatus, type SandboxResult } from '@sealflare/shared/schemas'
import { cachePut } from './cache'
import { pauseSandbox } from './pause'
import { refundQuota } from './quota'
import { nextQueuedRun, runningRun, type RunRow, type SandboxDeps } from './queue'
import { WorkerRefused, type WorkerClient } from './workerClient'

/**
 * The poller of the queue.
 *
 * The queue runs one job at a time. Every pass of the poller either advances the run that is in
 * progress or starts the next one that waits. A run that fails because of our own infrastructure
 * gives the quota back; a run that fails because of the content of the skill does not.
 */
export interface PollerDeps extends SandboxDeps {
  worker: WorkerClient
}

/** The reason a run ended, and who is to blame for it. */
type FailureCause = 'infrastructure' | 'skill_content'

/** The message of a run that could not start because the worker reached its daily cost limit. */
export const DAILY_LIMIT_MESSAGE = 'The daily limit of the sandbox worker is reached.'

/** One pass of the poller. */
export async function pollOnce(deps: PollerDeps): Promise<void> {
  const running = await runningRun(deps)
  if (running !== null) {
    await advance(deps, running)
    return
  }
  const queued = await nextQueuedRun(deps)
  if (queued !== null) await start(deps, queued)
}

/**
 * Hands the next run to the worker.
 *
 * A run that comes from the cache carries its result with it, so it is finished without the
 * worker and without a slot of the quota.
 *
 * The worker refuses a run when it is busy, and that is not a failure of the run: it waits in the
 * queue and is tried again. The daily cost limit of the worker ends the run, because no run of
 * today will start.
 */
async function start(deps: PollerDeps, row: RunRow): Promise<void> {
  if (row.from_cache) {
    await finishCached(deps, row)
    return
  }
  const request = {
    runId: row.run_id,
    bundleHash: row.bundle_hash as Hex,
    skillMd: row.skill_md ?? '',
    probeSetVersion: row.probe_set_version,
    modelId: row.model_id,
  }
  try {
    await deps.worker.start(request)
  } catch (error) {
    if (error instanceof WorkerRefused && error.reason === 'BUSY') return
    if (error instanceof WorkerRefused) {
      await pauseSandbox(deps, DAILY_LIMIT_MESSAGE)
      await failRun(deps, row, 'infrastructure', DAILY_LIMIT_MESSAGE)
      return
    }
    await failRun(deps, row, 'infrastructure', 'The sandbox worker could not be reached.')
    return
  }
  try {
    await deps.sql.query(
      `UPDATE sandbox_runs SET status = 'running', started_at = $2, worker_run_id = $3 WHERE run_id = $1`,
      [row.run_id, deps.now().toISOString(), row.run_id],
    )
  } catch {
    // Another service started a run at the same moment. That run owns the worker now.
  }
}

/** Finishes a run that came from the cache. The worker is never asked for it. */
async function finishCached(deps: PollerDeps, row: RunRow): Promise<void> {
  await deps.sql.query(
    `UPDATE sandbox_runs SET status = 'done', started_at = $2, finished_at = $2 WHERE run_id = $1`,
    [row.run_id, deps.now().toISOString()],
  )
}

/**
 * Reads what the worker has so far.
 *
 * Every violation the worker reports is stored at once, so it survives the worker disappearing
 * before the run ends. A run that reports a violation is a failed run, and that failure is kept
 * forever whatever happens to the rest of the run.
 */
async function advance(deps: PollerDeps, row: RunRow): Promise<void> {
  let status
  try {
    status = await deps.worker.status(row.worker_run_id ?? row.run_id)
  } catch {
    await failRun(deps, row, 'infrastructure', 'The sandbox worker could not be reached.')
    return
  }
  if (status === null) {
    await failRun(deps, row, 'infrastructure', 'The sandbox worker stopped answering.')
    return
  }
  await storeProbes(deps, row, status.probes, status.currentProbe)
  if (status.state !== 'done') return
  await finish(deps, row, status.result, status.failure?.cause, status.failure?.message, status.evidenceURI)
}

/** Stores the probe results the worker has reported so far. */
async function storeProbes(
  deps: PollerDeps,
  row: RunRow,
  probes: readonly ProbeResult[],
  currentProbe: string | undefined,
): Promise<void> {
  await deps.sql.query('UPDATE sandbox_runs SET probes = $2, current_probe = $3 WHERE run_id = $1', [
    row.run_id,
    JSON.stringify(probes),
    currentProbe ?? null,
  ])
  if (!hasViolation(probes)) return
  const result = buildResult(deps, row, probes, 'A forbidden tool call was caught.')
  await cachePut(deps, result)
}

/** Whether one of the runs of the probes broke a rule. */
function hasViolation(probes: readonly ProbeResult[]): boolean {
  return probes.some(probe => probe.runs.some(run => run.outcome === 'violation'))
}

/**
 * Ends a run that finished.
 *
 * The result of the run is stored in the cache, so the next reader of the bundle sees it without
 * running it again. Only an infrastructure failure gives the quota back.
 */
async function finish(
  deps: PollerDeps,
  row: RunRow,
  result: SandboxResult | undefined,
  cause: FailureCause | undefined,
  message: string | undefined,
  evidenceURI: string | undefined,
): Promise<void> {
  if (result !== undefined) await cachePut(deps, result)
  if (cause === 'infrastructure') await refundQuota(deps, row.run_id)
  const status = cause === undefined ? 'done' : 'incomplete'
  await deps.sql.query(
    `UPDATE sandbox_runs SET status = $2, result = $3, evidence_uri = $4, finished_at = $5,
       failure_cause = $6, failure_message = $7
     WHERE run_id = $1`,
    [
      row.run_id,
      status,
      result === undefined ? null : JSON.stringify(result),
      evidenceURI ?? null,
      deps.now().toISOString(),
      cause ?? null,
      message ?? null,
    ],
  )
}

/**
 * Ends a run that failed.
 *
 * The probes that were stored before the failure are kept, so a violation that was already caught
 * is still shown. The quota is only given back when the failure was ours.
 */
async function failRun(deps: PollerDeps, row: RunRow, cause: FailureCause, message: string): Promise<void> {
  const fresh = await readRow(deps, row.run_id)
  const probes = readProbes(fresh?.probes)
  const result = buildResult(deps, row, probes, message)
  if (result.status === 'SANDBOX_FUZZ_FAILED') await cachePut(deps, result)
  if (cause === 'infrastructure') await refundQuota(deps, row.run_id)
  await deps.sql.query(
    `UPDATE sandbox_runs SET status = 'incomplete', result = $2, finished_at = $3,
       failure_cause = $4, failure_message = $5
     WHERE run_id = $1`,
    [row.run_id, JSON.stringify(result), deps.now().toISOString(), cause, message],
  )
}

/** The row of a run, read again so the stored probes are the ones that were written last. */
async function readRow(deps: PollerDeps, runId: string): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>('SELECT * FROM sandbox_runs WHERE run_id = $1', [runId])
  return rows[0] ?? null
}

/** The stored probe results, or an empty list when they cannot be read. */
function readProbes(value: unknown): ProbeResult[] {
  const parsed = ProbeResult.array().safeParse(readJsonColumn(value))
  return parsed.success ? parsed.data : []
}

/** Postgres hands a jsonb column back as an object, but a driver may hand back text. */
function readJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * The result of a run that did not finish.
 *
 * The status follows from the probe results, so a run that caught a violation is a failed run and
 * never a clean one.
 */
function buildResult(deps: PollerDeps, row: RunRow, probes: readonly ProbeResult[], reason: string): SandboxResult {
  return {
    schemaVersion: 1,
    bundleHash: row.bundle_hash as Hex,
    probeSetVersion: row.probe_set_version,
    modelId: row.model_id,
    startedAt: iso(row.started_at ?? row.created_at),
    finishedAt: deps.now().toISOString(),
    status: deriveSandboxStatus(probes),
    incompleteReason: reason,
    probes: [...probes],
  }
}

/** A timestamp of the database as an ISO string. A driver may hand back a date or a text. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
