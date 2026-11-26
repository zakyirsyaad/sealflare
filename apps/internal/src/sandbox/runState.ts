import type { ProbeResult, SandboxResult, WorkerRunStatus } from '@sealflare/shared/schemas'
import { cachePut } from './cache'
import { refundQuota } from './quota'
import type { RunRow, SandboxDeps } from './queue'
import { buildResult, failureResult, overDeadline, readProbes, safeResult, type FailureCause } from './result'
import type { WorkerClient } from './workerClient'

/**
 * The state of the runs of the sandbox.
 *
 * A run moves through the states of the queue: it waits, it runs, and it ends with a result or
 * without one. Every change of state is guarded by the status the row had, so two passes of the
 * queue that overlap can never end the same run twice.
 *
 * The slot of the quota of a run comes back only when the run ends without a verdict about the
 * skill and the failure was ours. A run that caught a forbidden tool call did its job, so it
 * keeps its slot and is not blamed for anything.
 */
export interface RunDeps extends SandboxDeps {
  worker: WorkerClient
}

/** How many failed reads of the worker are allowed before the run is given up on. */
export const MAX_READ_FAILURES = 3

/** How long a run may go without a new probe run before it fails. */
export const RUN_DEADLINE_MS = 20 * 60_000

/**
 * How long a run that failed its deadline is still read, waiting for the worker.
 *
 * The window is short, because the slot of the quota of the run is only given back when the
 * following ends. A caller waits for the slot of a run it already sees as failed, so the window
 * is kept small: a worker that is alive but stuck does not hold the slot of the day for long.
 */
export const LATE_DEADLINE_MS = 5 * 60_000

/** The reason of a run that took longer than it may take. */
export const LATE_REASON = 'The sandbox run took longer than it may take.'

/** How long the transcript of a finished run is waited for. The worker uploads it after the run. */
export const EVIDENCE_DEADLINE_MS = 2 * 60_000

/** The blame of a run that ended, and what happens to the slot of its quota. */
interface Ending {
  /** Who is to blame for the run not ending normally. */
  cause: FailureCause | null
  /** Whether the slot of the quota comes back. */
  refund: boolean
}

/**
 * The blame of a run that ended, and what happens to the slot of its quota.
 *
 * A run that ended with a verdict about the skill did its job: the skill is at fault, so nothing
 * is blamed and the slot does not come back. Only a failure of our own infrastructure gives the
 * slot back, so a run that failed because of us does not cost the caller a run of the day.
 */
function endingOf(result: SandboxResult | null, cause: FailureCause | undefined): Ending {
  if (result !== null && result.status === 'SANDBOX_FUZZ_FAILED') return { cause: null, refund: false }
  return { cause: cause ?? null, refund: cause === 'infrastructure' }
}

/**
 * Reads what the worker has so far and moves the run on.
 *
 * Every violation the worker reports is stored at once, so it survives the worker disappearing
 * before the run ends. A run that reports a violation is a failed run, and that failure is kept
 * forever whatever happens to the rest of the run.
 */
export async function advanceRun(deps: RunDeps, row: RunRow): Promise<void> {
  const status = await readStatus(deps, row)
  if (status === null) return
  const moved = await storeProbes(deps, row, status.probes, status.currentProbe)
  if (status.state === 'done') {
    await completeRun(deps, row, status)
    return
  }
  await checkDeadline(deps, row, moved)
}

/**
 * Reads a run that failed its deadline and that the worker may still be going with.
 *
 * The worker runs many probes and may find a violation in the last ones, so the run is read until
 * the worker says it is done. The following stops when the worker may not be waited for any
 * longer, so a worker that disappeared does not keep the queue busy.
 */
export async function advanceLateRun(deps: RunDeps, row: RunRow): Promise<void> {
  const status = await readStatus(deps, row)
  if (status === null) return
  await storeProbes(deps, row, status.probes, status.currentProbe)
  if (status.state === 'done') {
    await completeLateRun(deps, row, status)
    return
  }
  if (overDeadline(row.late_since, deps.now(), LATE_DEADLINE_MS)) await stopFollowing(deps, row, LATE_REASON)
}

/**
 * Reads the status of a run from the worker.
 *
 * A worker that cannot be reached and a worker that does not know the run are both a read that
 * did not answer. The run keeps a count of them, so a worker that is restarting for a moment does
 * not lose a run that is still going on.
 */
async function readStatus(deps: RunDeps, row: RunRow): Promise<WorkerRunStatus | null> {
  let status: WorkerRunStatus | null
  try {
    status = await deps.worker.status(row.worker_run_id ?? row.run_id)
  } catch {
    await countFailure(deps, row, 'The sandbox worker could not be reached.')
    return null
  }
  if (status === null) {
    await countFailure(deps, row, 'The sandbox worker does not know the run.')
    return null
  }
  await deps.sql.query('UPDATE sandbox_runs SET read_failures = 0 WHERE run_id = $1', [row.run_id])
  return status
}

/**
 * Counts a read of the worker that did not answer.
 *
 * A worker that is restarting answers nothing for a moment. The run is only failed after a few
 * reads in a row failed, so a worker that comes back in time does not lose the run. A run that is
 * only being followed is stopped instead of failed, because it is already ended.
 */
async function countFailure(deps: RunDeps, row: RunRow, message: string): Promise<void> {
  const failures = row.read_failures + 1
  if (failures < MAX_READ_FAILURES) {
    await deps.sql.query('UPDATE sandbox_runs SET read_failures = $2 WHERE run_id = $1', [row.run_id, failures])
    return
  }
  if (row.late_since !== null) {
    await stopFollowing(deps, row, message)
    return
  }
  await failRun(deps, row, 'infrastructure', message)
}

/**
 * Stops following a run that failed its deadline.
 *
 * The worker may not be waited for any longer, so the run ends here. The reason comes from the
 * caller, because a run whose window ended is not a run whose worker went away: it keeps the
 * reason of the deadline it missed. Its slot of the quota comes back, unless the run already
 * ended with a verdict about the skill. The result the run reached is stored, so a violation the
 * worker found before it went away is still shown.
 */
async function stopFollowing(deps: RunDeps, row: RunRow, message: string): Promise<void> {
  const fresh = await freshRow(deps, row.run_id)
  const result = failureResult(deps, row, readProbes(fresh?.probes), message)
  const ending = endingOf(result, 'infrastructure')
  const rows = await deps.sql.query<{ run_id: string }>(
    `UPDATE sandbox_runs SET late_since = NULL, read_failures = 0, failure_cause = $2, failure_message = $4,
       result = COALESCE($3, result)
     WHERE run_id = $1 AND late_since IS NOT NULL RETURNING run_id`,
    [row.run_id, ending.cause, result === null ? null : JSON.stringify(result), message],
  )
  if (rows.length === 0) return
  if (ending.refund) await refundQuota(deps, row.run_id)
}

/**
 * Fails a run that does not move any more.
 *
 * The deadline is measured from the last new probe run and not from the start of the run, so a
 * run that is still moving is never failed.
 */
async function checkDeadline(deps: RunDeps, row: RunRow, moved: boolean): Promise<void> {
  const last = moved ? deps.now() : (row.progress_at ?? row.started_at)
  if (!overDeadline(last, deps.now(), RUN_DEADLINE_MS)) return
  await failLate(deps, row, LATE_REASON)
}

/**
 * Ends a run that the worker finished.
 *
 * The worker saves the transcript of a run in a later save than the run itself, so a run that is
 * done without a transcript is followed until the transcript shows up.
 */
async function completeRun(deps: RunDeps, row: RunRow, status: WorkerRunStatus): Promise<void> {
  const cause = status.failure?.cause
  const result = safeResult(status.result, cause)
  if (result !== null) await cachePut(deps, result)
  await finishRun(deps, row, result, cause, status.failure?.message, status.evidenceURI)
}

/**
 * Ends a run that failed its deadline and that the worker finished after all.
 *
 * The run stays failed, because it did miss its deadline. Its slot of the quota comes back now,
 * unless the run ended with a verdict about the skill: a run that caught a forbidden tool call
 * did its job, so nothing is blamed and the slot is not given back. The blame of the run is the
 * one the worker reports, so a run that ended because of the skill keeps its slot as well. A
 * violation the worker found at the end is still stored and cached, because a violation is never
 * hidden. A run that finished cleanly keeps no result, because the frozen schema has no
 * incomplete result whose probes are all clean.
 */
async function completeLateRun(deps: RunDeps, row: RunRow, status: WorkerRunStatus): Promise<void> {
  const fresh = await freshRow(deps, row.run_id)
  const result = failureResult(deps, row, readProbes(fresh?.probes), LATE_REASON)
  const ending = endingOf(result, status.failure?.cause ?? 'infrastructure')
  const rows = await deps.sql.query<{ run_id: string }>(
    `UPDATE sandbox_runs SET result = $2, evidence_uri = $3, evidence_since = $4, late_since = NULL, read_failures = 0,
       failure_cause = $5
     WHERE run_id = $1 AND late_since IS NOT NULL RETURNING run_id`,
    [
      row.run_id,
      result === null ? null : JSON.stringify(result),
      status.evidenceURI ?? null,
      status.evidenceURI === undefined ? deps.now().toISOString() : null,
      ending.cause,
    ],
  )
  if (rows.length === 0) return
  if (result !== null && result.status === 'SANDBOX_FUZZ_FAILED') await cachePut(deps, result)
  if (ending.refund) await refundQuota(deps, row.run_id)
}

/**
 * Reads the transcript of a run that is done without one.
 *
 * The worker uploads the transcript after the run itself, so the run is followed until the
 * transcript shows up. The following stops when the transcript may not be waited for any longer,
 * so a worker that never uploads it does not keep the queue busy.
 */
export async function collectEvidence(deps: RunDeps, row: RunRow): Promise<void> {
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

/**
 * Stores the probe results the worker has reported so far.
 *
 * The moment the run showed a new probe run is stored with it. That moment is the progress of the
 * run, so the deadline of the run is measured from it and a run that is still moving is never
 * failed.
 */
async function storeProbes(
  deps: RunDeps,
  row: RunRow,
  probes: readonly ProbeResult[],
  currentProbe: string | undefined,
): Promise<boolean> {
  const moved = countProbeRuns(probes) > countProbeRuns(readProbes(row.probes))
  await deps.sql.query(
    `UPDATE sandbox_runs SET probes = $2, current_probe = $3,
       progress_at = CASE WHEN $4 THEN $5 ELSE progress_at END
     WHERE run_id = $1`,
    [row.run_id, JSON.stringify(probes), currentProbe ?? null, moved, deps.now().toISOString()],
  )
  if (hasViolation(probes)) {
    const result = buildResult(deps, row, probes, 'A forbidden tool call was caught.')
    await cachePut(deps, result)
  }
  return moved
}

/** Whether one of the runs of the probes broke a rule. */
function hasViolation(probes: readonly ProbeResult[]): boolean {
  return probes.some(probe => probe.runs.some(run => run.outcome === 'violation'))
}

/** How many probe runs the worker has reported. It is the progress of a run. */
export function countProbeRuns(probes: readonly ProbeResult[]): number {
  return probes.reduce((total, probe) => total + probe.runs.length, 0)
}

/**
 * Ends a run that the worker finished.
 *
 * The result of the run is stored in the cache, so the next reader of the bundle sees it without
 * running it again. Only an infrastructure failure gives the quota back, and a run that ended
 * with a verdict about the skill does not get its slot back at all.
 *
 * The update only touches a run that is still running, so a pass that is late cannot rewrite a run
 * that another pass already ended. The quota is only given back when the update hit a row.
 */
async function finishRun(
  deps: RunDeps,
  row: RunRow,
  result: SandboxResult | null,
  cause: FailureCause | undefined,
  message: string | undefined,
  evidenceURI: string | undefined,
): Promise<void> {
  const status = cause === undefined ? 'done' : 'incomplete'
  const waiting = evidenceURI === undefined && result !== null
  const ending = endingOf(result, cause)
  const rows = await deps.sql.query<{ run_id: string }>(
    `UPDATE sandbox_runs SET status = $2, result = $3, evidence_uri = $4, finished_at = $5,
       failure_cause = $6, failure_message = $7, evidence_since = $8, read_failures = 0
     WHERE run_id = $1 AND status = 'running' RETURNING run_id`,
    [
      row.run_id,
      status,
      result === null ? null : JSON.stringify(result),
      evidenceURI ?? null,
      deps.now().toISOString(),
      ending.cause,
      message ?? null,
      waiting ? deps.now().toISOString() : null,
    ],
  )
  if (rows.length === 0) return
  if (ending.refund) await refundQuota(deps, row.run_id)
}

/**
 * Ends a run that failed.
 *
 * The probes that were stored before the failure are kept, so a violation that was already caught
 * is still shown. The quota is only given back when the failure was ours and the run did not end
 * with a verdict about the skill.
 *
 * The update only touches a run that has not ended yet, so two passes that overlap cannot end the
 * same run twice. The quota is only given back when the update hit a row.
 */
export async function failRun(deps: RunDeps, row: RunRow, cause: FailureCause, message: string): Promise<void> {
  const fresh = await freshRow(deps, row.run_id)
  const result = failureResult(deps, row, readProbes(fresh?.probes), message)
  const ending = endingOf(result, cause)
  const rows = await deps.sql.query<{ run_id: string }>(
    `UPDATE sandbox_runs SET status = 'incomplete', result = $2, finished_at = $3,
       failure_cause = $4, failure_message = $5, evidence_since = NULL, read_failures = 0
     WHERE run_id = $1 AND status IN ('queued', 'running') RETURNING run_id`,
    [row.run_id, result === null ? null : JSON.stringify(result), deps.now().toISOString(), ending.cause, message],
  )
  if (rows.length === 0) return
  if (result !== null && result.status === 'SANDBOX_FUZZ_FAILED') await cachePut(deps, result)
  if (ending.refund) await refundQuota(deps, row.run_id)
}

/**
 * Fails a run that does not move any more and keeps reading it.
 *
 * The run is shown as failed, but the worker may still be going with it, so the run is followed
 * until the worker says it is done. The slot of the quota comes back only then: a run that ends
 * with a verdict about the skill did its job, and a run that ends without one failed for a
 * reason of ours.
 */
async function failLate(deps: RunDeps, row: RunRow, message: string): Promise<void> {
  const fresh = await freshRow(deps, row.run_id)
  const result = failureResult(deps, row, readProbes(fresh?.probes), message)
  const ending = endingOf(result, 'infrastructure')
  const rows = await deps.sql.query<{ run_id: string }>(
    `UPDATE sandbox_runs SET status = 'incomplete', result = $2, finished_at = $3,
       failure_cause = $4, failure_message = $5, late_since = $6, read_failures = 0
     WHERE run_id = $1 AND status = 'running' RETURNING run_id`,
    [
      row.run_id,
      result === null ? null : JSON.stringify(result),
      deps.now().toISOString(),
      ending.cause,
      message,
      deps.now().toISOString(),
    ],
  )
  if (rows.length === 0) return
  if (result !== null && result.status === 'SANDBOX_FUZZ_FAILED') await cachePut(deps, result)
}

/** The row of a run, read again so the stored probes are the ones that were written last. */
async function freshRow(deps: RunDeps, runId: string): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>('SELECT * FROM sandbox_runs WHERE run_id = $1', [runId])
  return rows[0] ?? null
}
