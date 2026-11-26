import { randomBytes } from 'node:crypto'
import { SandboxResult, type ProbeId } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { utcDay } from './quota'

/**
 * The queue of sandbox runs.
 *
 * One run at a time: the index on the table refuses a second run in the state `running`, so two
 * services that both try to start the next job cannot run two jobs at once. Every run keeps the
 * address that asked for it, the bundle it is about, and the state it reached.
 */
export interface SandboxDeps {
  sql: Db
  now: () => Date
  probeSetVersion: string
  modelId: string
}

/** The states a run can be in. The table holds the same four. */
export const RUN_STATUSES = ['queued', 'running', 'done', 'incomplete'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** One row of the queue. */
export interface RunRow {
  run_id: string
  seq: number
  address: string
  bundle_hash: string
  probe_set_version: string
  model_id: string
  status: RunStatus
  queue_position: number | null
  current_probe: string | null
  result: unknown
  evidence_uri: string | null
  failure_cause: 'infrastructure' | 'skill_content' | null
  failure_message: string | null
  quota_refunded: boolean
  created_at: string
  started_at: string | null
  finished_at: string | null
  src: string | null
  quota_day: string | null
  probes: unknown
  worker_run_id: string | null
  skill_md: string | null
  from_cache: boolean
  /** How many reads of the worker failed in a row. The run is failed when it reaches the limit. */
  read_failures: number
  /** The moment the run was seen as done without a transcript. The transcript is waited for. */
  evidence_since: string | null
}

/** What the API shows about a run. */
export interface RunState {
  runId: string
  status: RunStatus
  queuePosition?: number
  currentProbe?: ProbeId
  result?: SandboxResult
  evidenceURI?: string
}

/** A run id nobody else can guess, so a run is never addressed by accident. */
export function newRunId(): string {
  return `run_${randomBytes(12).toString('hex')}`
}

/**
 * The position of a run in the queue, counted from one.
 *
 * The position is read from the queue itself and not from the column, so it stays right when
 * another run is started or finished.
 */
export async function positionOf(deps: SandboxDeps, row: RunRow): Promise<number> {
  const rows = await deps.sql.query<{ position: number }>(
    `SELECT count(*)::int AS position FROM sandbox_runs
     WHERE status = 'queued' AND seq <= $1`,
    [row.seq],
  )
  return rows[0]?.position ?? 1
}

/** The row of a run, or null when there is no such run. */
export async function runRow(deps: SandboxDeps, runId: string): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>('SELECT * FROM sandbox_runs WHERE run_id = $1', [runId])
  return rows[0] ?? null
}

/** The run that is in progress, if there is one. */
export async function runningRun(deps: SandboxDeps): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>(
    `SELECT * FROM sandbox_runs WHERE status = 'running' ORDER BY seq LIMIT 1`,
  )
  return rows[0] ?? null
}

/** The oldest run that still waits for the worker. */
export async function nextQueuedRun(deps: SandboxDeps): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>(
    `SELECT * FROM sandbox_runs WHERE status = 'queued' ORDER BY seq LIMIT 1`,
  )
  return rows[0] ?? null
}

/**
 * The oldest run that waited longer than it may wait.
 *
 * A run that waits for good holds a slot of the quota and never ends, so it is failed as an
 * infrastructure failure instead.
 */
export async function expiredQueuedRun(deps: SandboxDeps, limitMs: number): Promise<RunRow | null> {
  const before = new Date(deps.now().getTime() - limitMs).toISOString()
  const rows = await deps.sql.query<RunRow>(
    `SELECT * FROM sandbox_runs WHERE status = 'queued' AND created_at < $1 ORDER BY seq LIMIT 1`,
    [before],
  )
  return rows[0] ?? null
}

/**
 * The oldest run that is finished but whose transcript is still waited for.
 *
 * The worker uploads the transcript of a run after the run itself, so the run is followed until
 * the transcript shows up.
 */
export async function awaitingEvidenceRun(deps: SandboxDeps): Promise<RunRow | null> {
  const rows = await deps.sql.query<RunRow>(
    `SELECT * FROM sandbox_runs
     WHERE evidence_uri IS NULL AND evidence_since IS NOT NULL AND status IN ('done', 'incomplete')
     ORDER BY seq LIMIT 1`,
  )
  return rows[0] ?? null
}

/**
 * Puts a run in the queue.
 *
 * The row is written after the quota was taken, so a run that is in the queue has a slot
 * reserved for it. The queue position is stored as well, and read again whenever it is shown.
 *
 * A run that comes from the cache carries its result with it and takes no slot of the quota: the
 * worker is never asked for it.
 */
export async function enqueue(
  deps: SandboxDeps,
  input: {
    runId: string
    address: string
    bundleHash: string
    src: string
    skillMd: string
    cached?: SandboxResult | null
  },
): Promise<number> {
  const now = deps.now()
  const cached = input.cached ?? null
  const rows = await deps.sql.query<RunRow>(
    `INSERT INTO sandbox_runs
       (run_id, address, bundle_hash, probe_set_version, model_id, status, src, skill_md,
        quota_day, result, from_cache, created_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8::date, $9, $10, $11)
     RETURNING *`,
    [
      input.runId,
      input.address,
      input.bundleHash,
      deps.probeSetVersion,
      deps.modelId,
      input.src,
      input.skillMd,
      cached === null ? utcDay(now) : null,
      cached === null ? null : JSON.stringify(cached),
      cached !== null,
      now.toISOString(),
    ],
  )
  const row = rows[0]
  if (row === undefined) throw new Error('The run could not be queued.')
  return positionOf(deps, row)
}

/**
 * The state of a run, as the API shows it.
 *
 * A run that is still running shows the probe it is on. A run that has ended shows its result,
 * which is never a clean result unless every probe finished every run cleanly.
 */
export async function readRun(deps: SandboxDeps, runId: string): Promise<RunState | null> {
  const row = await runRow(deps, runId)
  if (row === null) return null
  const state: RunState = { runId: row.run_id, status: row.status }
  if (row.status === 'queued') return { ...state, queuePosition: await positionOf(deps, row) }
  if (row.status === 'running') {
    return row.current_probe === null ? state : { ...state, currentProbe: row.current_probe as ProbeId }
  }
  const result = readResult(row.result)
  if (result !== null) {
    return row.evidence_uri === null ? { ...state, result } : { ...state, result, evidenceURI: row.evidence_uri }
  }
  return state
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
 * The stored result of a run, or null when it cannot be read.
 *
 * The frozen schema is the judge, as in the cache: a result whose status does not follow from its
 * probes is not a result, so it can never be shown as a clean one.
 */
export function readResult(value: unknown): SandboxResult | null {
  const parsed = SandboxResult.safeParse(readJsonColumn(value))
  return parsed.success ? parsed.data : null
}
