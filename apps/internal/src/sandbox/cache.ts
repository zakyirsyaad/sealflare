import { SandboxResult } from '@sealflare/shared/schemas'
import type { Db } from '../db'

/**
 * The cache of sandbox results.
 *
 * The cache is asymmetric on purpose. A failed result is kept forever and is found by the bundle
 * alone, whatever probe set version and model produced it: a skill cannot lose its trace by
 * changing the model. A clean result only matches while the probe set version and the model are
 * the same, because a clean result says nothing about another model or another probe set.
 */
export interface CacheDeps {
  sql: Db
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
 * A result that cannot be read is not a result. An unreadable row is treated as no row, so it can
 * never be shown as a clean one.
 */
function parseResult(value: unknown): SandboxResult | null {
  const parsed = SandboxResult.safeParse(readJsonColumn(value))
  return parsed.success ? parsed.data : null
}

/**
 * The cached result of a bundle.
 *
 * A failed result is looked for first and is found by the bundle alone. Only when there is no
 * failure is the exact key used, so a clean result of another model never answers for this one.
 */
export async function cacheGet(
  deps: CacheDeps,
  bundleHash: string,
  probeSetVersion: string,
  modelId: string,
): Promise<SandboxResult | null> {
  const failed = await deps.sql.query<{ result: unknown }>(
    `SELECT result FROM sandbox_cache WHERE bundle_hash = $1 AND status = 'SANDBOX_FUZZ_FAILED' LIMIT 1`,
    [bundleHash],
  )
  const failure = failed[0]
  if (failure !== undefined) return parseResult(failure.result)

  const exact = await deps.sql.query<{ result: unknown }>(
    `SELECT result FROM sandbox_cache WHERE bundle_hash = $1 AND probe_set_version = $2 AND model_id = $3`,
    [bundleHash, probeSetVersion, modelId],
  )
  const row = exact[0]
  return row === undefined ? null : parseResult(row.result)
}

/**
 * Stores a result.
 *
 * A run that did not finish says nothing about the skill, so it is not kept: the next reader of
 * the bundle runs it again.
 *
 * A bundle that already failed keeps that failure. A later clean result of the same bundle is not
 * stored, because the failed result is the one that is shown and it is never removed.
 */
export async function cachePut(deps: CacheDeps, result: SandboxResult): Promise<void> {
  const parsed = SandboxResult.parse(result)
  if (parsed.status === 'INCOMPLETE') return
  const failed = await deps.sql.query<{ bundle_hash: string }>(
    `SELECT bundle_hash FROM sandbox_cache WHERE bundle_hash = $1 AND status = 'SANDBOX_FUZZ_FAILED' LIMIT 1`,
    [parsed.bundleHash],
  )
  if (failed.length > 0 && parsed.status !== 'SANDBOX_FUZZ_FAILED') return
  await deps.sql.query(
    `INSERT INTO sandbox_cache (bundle_hash, probe_set_version, model_id, result, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (bundle_hash, probe_set_version, model_id) DO UPDATE
       SET result = EXCLUDED.result, status = EXCLUDED.status, created_at = EXCLUDED.created_at`,
    [
      parsed.bundleHash,
      parsed.probeSetVersion,
      parsed.modelId,
      JSON.stringify(parsed),
      parsed.status,
      parsed.finishedAt,
    ],
  )
}
