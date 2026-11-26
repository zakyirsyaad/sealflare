import type { Hex } from 'viem'
import { ProbeResult, deriveSandboxStatus, type SandboxResult, type WorkerRunStatus } from '@sealflare/shared/schemas'
import { cachePut } from './cache'
import { pauseSandbox } from './pause'
import { refundQuota } from './quota'
import { awaitingEvidenceRun, expiredQueuedRun, nextQueuedRun, runningRun, type RunRow, type SandboxDeps } from './queue'
import { WorkerRefused, WorkerRejected, type WorkerClient } from './workerClient'

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

/** How many failed reads of the worker are allowed before the run is failed. */
export const MAX_READ_FAILURES = 3

/** How long a run may wait in the queue before it is failed as an infrastructure failure. */
export const QUEUE_DEADLINE_MS = 30 * 60_000

/** How long a run may run before it is failed as an infrastructure failure. */
export const RUN_DEADLINE_MS = 20 * 60_000

/** How long the transcript of a finished run is waited for. The worker uploads it after the run. */
export const EVIDENCE_DEADLINE_MS = 2 * 60_000

/** One pass of the poller. */
export async function pollOnce(deps: PollerDeps): Promise<void> {
  // The transcript of a run that is done is collected first, so it is recorded even while the
  // next run is going on.
  const evidence = await awaitingEvidenceRun(deps)
  if (evidence !== null) await collectEvidence(deps, evidence)
  const running = await runningRun(deps)
  if (running !== null) {
    await advance(deps, running)
    return
  }
  const expired = await expiredQueuedRun(deps, QUEUE_DEADLINE_MS)
  if (expired !== null) {
    await failRun(deps, expired, 'infrastructure', 'The sandbox worker did not take the run in time.')
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
  if (row.skill_md === null || row.skill_md.length === 0) {
    // The run never reached the worker, because there was no skill to give it. The worker would
    // refuse a request without one, so nothing is sent.
    await failRun(deps, row, 'infrastructure', 'The skill of the run could not be read.')
    return
  }
  const request = {
    runId: row.run_id,
    bundleHash: row.bundle_hash as Hex,
    skillMd: row.skill_md,
    probeSetVersion: row.probe_set_version,
    modelId: row.model_id,
  }
  try {
    await deps.worker.start(request)
  } catch (error) {
    await refuse(deps, row, error)
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

/**
 * Handles the refusal of the worker.
 *
 * A busy worker is asked whether it is healthy. A worker that is busy and healthy is running
 * another run, so the run waits in the queue until its deadline. A worker that is busy and not
 * healthy never takes the run, so the run ends now instead of waiting for good.
 */
async function refuse(deps: PollerDeps, row: RunRow, error: unknown): Promise<void> {
  if (error instanceof WorkerRefused && error.reason === 'BUSY') {
    if (!(await workerIsHealthy(deps))) {
      await failRun(deps, row, 'infrastructure', 'The sandbox worker is not available.')
    }
    return
  }
  if (error instanceof WorkerRefused) {
    await pauseSandbox(deps, DAILY_LIMIT_MESSAGE)
    await failRun(deps, row, 'infrastructure', DAILY_LIMIT_MESSAGE)
    return
  }
  if (error instanceof WorkerRejected) {
    await failRun(deps, row, 'infrastructure', 'The sandbox worker did not accept the request.')
    return
  }
  await failRun(deps, row, 'infrastructure', 'The sandbox worker could not be reached.')
}

/** Whether the worker is healthy. A worker that cannot be reached is not healthy. */
async function workerIsHealthy(deps: PollerDeps): Promise<boolean> {
  try {
    return await deps.worker.health()
  } catch {
    return false
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
  let status: WorkerRunStatus | null
  try {
    status = await deps.worker.status(row.worker_run_id ?? row.run_id)
  } catch {
    await countFailure(deps, row, 'The sandbox worker could not be reached.')
    return
  }
  if (status === null) {
    await countFailure(deps, row, 'The sandbox worker does not know the run.')
    return
  }
  await deps.sql.query('UPDATE sandbox_runs SET read_failures = 0 WHERE run_id = $1', [row.run_id])
  await storeProbes(deps, row, status.probes, status.currentProbe)
  if (status.state !== 'done') {
    if (overDeadline(row.started_at, deps.now(), RUN_DEADLINE_MS)) {
      await failRun(deps, row, 'infrastructure', 'The sandbox run took longer than it may take.')
    }
    return
  }
  await complete(deps, row, status)
}

/**
 * Counts a read of the worker that did not answer.
 *
 * A worker that is restarting answers nothing for a moment. The run is only failed after a few
 * reads in a row failed, so a worker that comes back in time does not lose the run.
 */
async function countFailure(deps: PollerDeps, row: RunRow, message: string): Promise<void> {
  const failures = row.read_failures + 1
  if (failures >= MAX_READ_FAILURES) {
    await failRun(deps, row, 'infrastructure', message)
    return
  }
  await deps.sql.query('UPDATE sandbox_runs SET read_failures = $2 WHERE run_id = $1', [row.run_id, failures])
}

/**
 * Ends a run that the worker finished.
 *
 * The worker saves the transcript of a run in a later save than the run itself, so a run that is
 * done without a transcript is followed until the transcript shows up.
 */
async function complete(deps: PollerDeps, row: RunRow, status: WorkerRunStatus): Promise<void> {
  const cause = status.failure?.cause
  const result = safeResult(status.result, cause)
  if (result !== null) await cachePut(deps, result)
  await finish(deps, row, result, cause, status.failure?.message, status.evidenceURI)
}

/**
 * Reads the transcript of a run that is done without one.
 *
 * The worker uploads the transcript after the run itself, so the run is followed until the
 * transcript shows up. The following stops when the transcript may not be waited for any longer,
 * so a worker that never uploads it does not keep the queue busy.
 */
async function collectEvidence(deps: PollerDeps, row: RunRow): Promise<void> {
  let status: WorkerRunStatus | null = null
  try {
    status = await deps.worker.status(row.worker_run_id ?? row.run_id)
  } catch {
    status = null
  }
  if (status?.evidenceURI !== undefined) {
    await deps.sql.query('UPDATE sandbox_runs SET evidence_uri = $2, evidence_since = NULL WHERE run_id = $1', [
      row.run_id,
      status.evidenceURI,
    ])
    return
  }
  if (overDeadline(row.evidence_since, deps.now(), EVIDENCE_DEADLINE_MS)) {
    await deps.sql.query('UPDATE sandbox_runs SET evidence_since = NULL WHERE run_id = $1', [row.run_id])
  }
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
 *
 * A run that is done without a transcript is followed, so the transcript of the run is still
 * recorded when the worker uploads it.
 */
async function finish(
  deps: PollerDeps,
  row: RunRow,
  result: SandboxResult | null,
  cause: FailureCause | undefined,
  message: string | undefined,
  evidenceURI: string | undefined,
): Promise<void> {
  if (cause === 'infrastructure') await refundQuota(deps, row.run_id)
  const status = cause === undefined ? 'done' : 'incomplete'
  const waiting = evidenceURI === undefined && result !== null
  await deps.sql.query(
    `UPDATE sandbox_runs SET status = $2, result = $3, evidence_uri = $4, finished_at = $5,
       failure_cause = $6, failure_message = $7, evidence_since = $8, read_failures = 0
     WHERE run_id = $1`,
    [
      row.run_id,
      status,
      result === null ? null : JSON.stringify(result),
      evidenceURI ?? null,
      deps.now().toISOString(),
      cause ?? null,
      message ?? null,
      waiting ? deps.now().toISOString() : null,
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
  const result = failureResult(deps, row, probes, message)
  if (result !== null && result.status === 'SANDBOX_FUZZ_FAILED') await cachePut(deps, result)
  if (cause === 'infrastructure') await refundQuota(deps, row.run_id)
  await deps.sql.query(
    `UPDATE sandbox_runs SET status = 'incomplete', result = $2, finished_at = $3,
       failure_cause = $4, failure_message = $5, evidence_since = NULL, read_failures = 0
     WHERE run_id = $1`,
    [row.run_id, result === null ? null : JSON.stringify(result), deps.now().toISOString(), cause, message],
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
 * A run that did not finish is never a clean run. The frozen schema does not allow an incomplete
 * result whose probes are all clean, so such a run keeps no result at all: it is shown as a run
 * that ended without one, never as a run that found nothing.
 */
function failureResult(
  deps: PollerDeps,
  row: RunRow,
  probes: readonly ProbeResult[],
  reason: string,
): SandboxResult | null {
  const status = deriveSandboxStatus(probes)
  if (status === 'NO_VIOLATION_OBSERVED') return null
  return buildResult(deps, row, probes, reason)
}

/**
 * The result of a run, when it may be shown.
 *
 * A run that failed never shows a clean result, whatever the worker reported.
 */
function safeResult(result: SandboxResult | undefined, cause: FailureCause | undefined): SandboxResult | null {
  if (result === undefined) return null
  if (cause !== undefined && result.status === 'NO_VIOLATION_OBSERVED') return null
  return result
}

/**
 * The result of a run.
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

/** Whether a moment lies further in the past than the limit allows. */
function overDeadline(value: unknown, now: Date, limitMs: number): boolean {
  if (value === null || value === undefined) return false
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isFinite(time)) return false
  return now.getTime() - time > limitMs
}

/** A timestamp of the database as an ISO string. A driver may hand back a date or a text. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}
