import { ScanReport, SandboxResult } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { jsonColumn } from './values'

/**
 * The cached results of a target: the last scan and the last sandbox run.
 *
 * Both caches hold a result of a version that can expire, so a result is only shown when it
 * still belongs to the target it is attached to.
 */

/** The columns the cache reads need to know about the target. */
export interface CachedTarget {
  targetId: string
  targetType: string
  codehash: string | null
  bundleHash: string | null
}

/** The cached scan of a target: the report and the source that was pinned with it. */
export interface CachedScan {
  report: ScanReport | null
  src: string | null
}

/**
 * The last scan of a target, when it is the scan of this version.
 *
 * A contract is identified by its address, so a scan of other bytecode at the same address is
 * not the scan of this target. The scan is only attached when the code hash of the report is
 * the one the registry pinned, and the page then says that this version has not been scanned.
 *
 * A report that cannot be read is not shown as a scan either. It is logged, and the page shows
 * no findings instead of a result nobody can check.
 *
 * The source is the one that was pinned with the first scan, not the one of the report, so the
 * page always names the same repository for the same target.
 */
export async function readScan(sql: Db, target: CachedTarget): Promise<CachedScan> {
  const rows = await sql.query<{ src: string | null; report: unknown }>(
    'SELECT src, report FROM scan_cache WHERE target_id = $1',
    [target.targetId],
  )
  const row = rows[0]
  if (!row) return { report: null, src: null }
  const report = ScanReport.safeParse(jsonColumn(row.report))
  if (!report.success) {
    console.warn('the stored scan report cannot be read', { targetId: target.targetId })
    return { report: null, src: row.src }
  }
  if (
    target.targetType === 'SMART_CONTRACT' &&
    report.data.source.kind === 'contract' &&
    target.codehash !== null &&
    report.data.source.codehash.toLowerCase() !== target.codehash.toLowerCase()
  ) {
    return { report: null, src: row.src }
  }
  return { report: report.data, src: row.src }
}

/** The probe set and the model the service runs now. */
export interface SandboxVersion {
  probeSetVersion: string
  modelId: string
}

/**
 * The last sandbox result of a skill.
 *
 * A failed result is kept forever, so a fuzz failure is never hidden by a clean result that came
 * later. The failure comes first, and only then the newest result. A result that is still
 * `INCOMPLETE` is not a clean result, so the newest result of all is shown in that case.
 *
 * A clean result expires when the model or the probe set changes, so it is only shown when it
 * comes from the version the service runs now. When the service does not know that version, no
 * clean result is shown at all: a result of an unknown version cannot be called current.
 */
export async function readSandbox(
  sql: Db,
  bundleHash: string | null,
  current: SandboxVersion | null,
): Promise<unknown | null> {
  if (!bundleHash) return null
  const rows =
    current === null
      ? await sql.query<{ result: unknown }>(
          `SELECT result FROM sandbox_cache WHERE bundle_hash = $1 AND status = 'SANDBOX_FUZZ_FAILED'
           ORDER BY created_at DESC LIMIT 1`,
          [bundleHash],
        )
      : await sql.query<{ result: unknown }>(
          `SELECT result FROM sandbox_cache
           WHERE bundle_hash = $1
             AND (status = 'SANDBOX_FUZZ_FAILED' OR (probe_set_version = $2 AND model_id = $3))
           ORDER BY (status = 'SANDBOX_FUZZ_FAILED') DESC NULLS LAST, created_at DESC LIMIT 1`,
          [bundleHash, current.probeSetVersion, current.modelId],
        )
  const row = rows[0]
  if (!row) return null
  const result = SandboxResult.safeParse(jsonColumn(row.result))
  if (!result.success) throw new Error('the stored sandbox result cannot be read')
  return result.data
}
