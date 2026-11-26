import type { Hex } from 'viem'
import { pauseSandbox } from './pause'
import { awaitingEvidenceRun, lateRun, nextQueuedRun, runningRun, type RunRow, type SandboxDeps } from './queue'
import { advanceLateRun, advanceRun, collectEvidence, failRun } from './runState'
import { overDeadline } from './result'
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

/** The message of a run that could not start because the worker reached its daily cost limit. */
export const DAILY_LIMIT_MESSAGE = 'The daily limit of the sandbox worker is reached.'

/**
 * How long a run may wait for a busy worker before it is failed.
 *
 * The wait is measured from the first refusal of the worker, not from the moment the run entered
 * the queue. A run that waits behind a run of ours has not waited for the worker at all, so it is
 * not the worker's fault that it had to wait.
 */
export const QUEUE_DEADLINE_MS = 30 * 60_000

/** How often the queue looks at the worker. */
export const POLL_INTERVAL_MS = 3_000

/** One pass of the poller. */
export async function pollOnce(deps: PollerDeps): Promise<void> {
  // The transcript of a run that is done is collected first, so it is recorded even while the
  // next run is going on.
  const evidence = await awaitingEvidenceRun(deps)
  if (evidence !== null) await collectEvidence(deps, evidence)
  // A run that failed its deadline is still read, so a violation the worker finds at the end
  // still reaches the cache.
  const late = await lateRun(deps)
  if (late !== null) await advanceLateRun(deps, late)
  const running = await runningRun(deps)
  if (running !== null) {
    await advanceRun(deps, running)
    return
  }
  const queued = await nextQueuedRun(deps)
  if (queued !== null) await start(deps, queued)
}

/**
 * The queue of the sandbox, pass after pass.
 *
 * Every pass waits for the one before it, so two passes never read the same run at the same time.
 * A pass that fails does not stop the queue: the next pass simply tries again.
 */
export async function runQueue(
  deps: PollerDeps,
  options: {
    intervalMs?: number
    sleep?: (ms: number) => Promise<void>
    isStopped?: () => boolean
    onError?: (error: unknown) => void
  } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const sleep = options.sleep ?? defaultSleep
  const isStopped = options.isStopped ?? ((): boolean => false)
  const onError = options.onError ?? ((): void => undefined)
  while (!isStopped()) {
    try {
      await pollOnce(deps)
    } catch (error) {
      onError(error)
    }
    await sleep(intervalMs)
  }
}

/** Waits for a while. The timer does not hold the process open. */
async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
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
      return
    }
    await waitInQueue(deps, row)
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

/**
 * Keeps a run in the queue while the worker is busy.
 *
 * The moment of the first refusal is kept, so the deadline is measured from the moment the worker
 * started to refuse and not from the moment the run entered the queue. A run that waits too long
 * for a busy worker is failed as an infrastructure failure, and its slot of the quota comes back.
 */
async function waitInQueue(deps: PollerDeps, row: RunRow): Promise<void> {
  const now = deps.now().toISOString()
  const rows = await deps.sql.query<{ busy_since: string }>(
    `UPDATE sandbox_runs SET busy_since = COALESCE(busy_since, $2) WHERE run_id = $1 RETURNING busy_since`,
    [row.run_id, now],
  )
  const busySince = rows[0]?.busy_since ?? now
  if (overDeadline(busySince, deps.now(), QUEUE_DEADLINE_MS)) {
    await failRun(deps, row, 'infrastructure', 'The sandbox worker did not take the run in time.')
  }
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
    `UPDATE sandbox_runs SET status = 'done', started_at = $2, finished_at = $2 WHERE run_id = $1 AND status = 'queued'`,
    [row.run_id, deps.now().toISOString()],
  )
}
