import type { Hex } from 'viem'
import { ProbeResult, deriveSandboxStatus, type SandboxResult } from '@sealflare/shared/schemas'
import type { RunRow, SandboxDeps } from './queue'

/**
 * The results of the sandbox runs.
 *
 * A result that is shown to a caller follows from the probe runs it holds. A run that did not
 * finish is never a clean run, so a failure never shows "no violation observed".
 */

/** The reason a run ended, and who is to blame for it. */
export type FailureCause = 'infrastructure' | 'skill_content'

/**
 * The result of a run.
 *
 * The status follows from the probe results, so a run that caught a violation is a failed run and
 * never a clean one.
 */
export function buildResult(
  deps: SandboxDeps,
  row: RunRow,
  probes: readonly ProbeResult[],
  reason: string,
): SandboxResult {
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

/**
 * The result of a run that did not finish.
 *
 * A run that did not finish is never a clean run. The frozen schema does not allow an incomplete
 * result whose probes are all clean, so such a run keeps no result at all: it is shown as a run
 * that ended without one, never as a run that found nothing.
 */
export function failureResult(
  deps: SandboxDeps,
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
export function safeResult(result: SandboxResult | undefined, cause: FailureCause | undefined): SandboxResult | null {
  if (result === undefined) return null
  if (cause !== undefined && result.status === 'NO_VIOLATION_OBSERVED') return null
  return result
}

/** The stored probe results, or an empty list when they cannot be read. */
export function readProbes(value: unknown): ProbeResult[] {
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

/** A timestamp of the database as an ISO string. A driver may hand back a date or a text. */
function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/** Whether a moment lies further in the past than the limit allows. */
export function overDeadline(value: unknown, now: Date, limitMs: number): boolean {
  if (value === null || value === undefined) return false
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value))
  if (!Number.isFinite(time)) return false
  return now.getTime() - time > limitMs
}
