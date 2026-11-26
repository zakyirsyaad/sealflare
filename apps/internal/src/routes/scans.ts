import { Hono } from 'hono'
import { z } from 'zod'
import { Bytes32Schema, ScanReport, decodeSrc, encodeSrc } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, ok } from '../respond'
import { sameRepository } from '../readModel/source'
import { readJson } from './json'

const TargetIdParam = z.object({ targetId: Bytes32Schema })

export interface ScanRouteDeps {
  sql: Db
}

/** Postgres and PGlite hand a jsonb column back as an object, but a driver may hand back text. */
function readJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const WRITE_ATTEMPTS = 3

interface ScanWrite {
  targetId: string
  src: string
  needsBind: boolean
  report: ScanReport
  scannedAt: string
}

/** The source a scan leaves in the row, given the source pinned before it and whether a publisher is bound. */
function pinnedSource(stored: string | null, incoming: string, bound: boolean, needsBind: boolean): string | null {
  if (stored === null) return bound || !needsBind ? incoming : null
  return sameRepository(stored, incoming) ? incoming : stored
}

/**
 * The report of a copy, with the repository of the pin where it names its own.
 *
 * The cache serves the report as it is stored, and the target page builds its source and its
 * version from `source` of the report. A report that names the repository of a copy would put that
 * repository back on the page next to the pinned one. Everything else the copy found is kept.
 */
function withPinnedSource(report: ScanReport, pinned: string): ScanReport {
  const decoded = decodeSrc(pinned)
  if (decoded === null || decoded.kind !== 'skill' || report.source.kind !== 'skill') return report
  const { owner, repo, commit, path } = decoded
  return { ...report, source: { ...report.source, repo: `${owner}/${repo}`, commit, path } }
}

/**
 * Writes the scan, keeping the pinned source. The write only lands when the stored source is still
 * the one the decision was made from, so two first scans cannot both pin. A scan older than the
 * stored one is dropped, because a scan that started earlier can arrive later than a newer one.
 */
async function writeScan(sql: Db, scan: ScanWrite): Promise<boolean> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const stored = await sql.query<{ src: string | null }>('SELECT src FROM scan_cache WHERE target_id = $1', [
      scan.targetId,
    ])
    const before = stored[0]?.src ?? null
    // A sponsor is no publisher: Core.sponsor is open to any Agent ID holder on an unbound target.
    const publisherRows = await sql.query(
      "SELECT 1 FROM targets WHERE target_id = $1 AND publisher_role = 'VERIFIED_PUBLISHER'",
      [scan.targetId],
    )
    const bound = publisherRows.length > 0
    const after = pinnedSource(before, scan.src, bound, scan.needsBind)
    const copied = before !== null && !sameRepository(before, scan.src)
    const report = copied ? withPinnedSource(scan.report, before) : scan.report

    const rows = await sql.query(
      `INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (target_id) DO UPDATE
         SET src = EXCLUDED.src, report = EXCLUDED.report, scanned_at = EXCLUDED.scanned_at
       WHERE scan_cache.src IS NOT DISTINCT FROM $5::text AND scan_cache.scanned_at <= EXCLUDED.scanned_at
       RETURNING target_id`,
      [scan.targetId, after, JSON.stringify(report), scan.scannedAt, before],
    )
    if (rows.length > 0) return true

    const current = await sql.query<{ src: string | null }>('SELECT src FROM scan_cache WHERE target_id = $1', [
      scan.targetId,
    ])
    if ((current[0]?.src ?? null) === before) return true
  }
  return false
}

/**
 * The last scan of a target, so a target page can be opened again without scanning again.
 */
export function scanRoutes(deps: ScanRouteDeps): Hono {
  const app = new Hono()

  app.put('/:targetId', async (c) => {
    const params = TargetIdParam.safeParse(c.req.param())
    if (!params.success) return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)

    const body = await readJson(c)
    if (!body.ok) return c.json(fail('BAD_REQUEST', 'The request body is not valid JSON.'), 400)
    const report = ScanReport.safeParse(body.value)
    if (!report.success) return c.json(fail('BAD_REQUEST', 'The scan report does not match the schema.'), 400)
    if (report.data.targetId !== params.data.targetId) {
      return c.json(fail('BAD_REQUEST', 'The scan report belongs to another target.'), 400)
    }

    // The target id of a skill binds the content and the publisher, not the repository, so a
    // copy of the folder in another repository is the same target. A skill pins its source only
    // after its publisher is bound, so a copy scanned before the bind cannot claim it. A scan of
    // another repository still refreshes the report, but never moves the pinned source.
    const src = encodeSrc(report.data.source)
    const needsBind = report.data.source.kind === 'skill'
    const written = await writeScan(deps.sql, {
      targetId: params.data.targetId,
      src,
      needsBind,
      report: report.data,
      scannedAt: report.data.scannedAt,
    })
    if (!written) console.warn('a scan was not cached after repeated conflicts', { targetId: params.data.targetId })
    return c.json(ok(report.data))
  })

  app.get('/:targetId', async (c) => {
    const params = TargetIdParam.safeParse(c.req.param())
    if (!params.success) return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)

    const rows = await deps.sql.query<{ report: unknown }>('SELECT report FROM scan_cache WHERE target_id = $1', [
      params.data.targetId,
    ])
    const row = rows[0]
    if (!row) return c.json(fail('RESULT_NOT_CACHED', 'This result is no longer cached.'), 404)

    const report = ScanReport.safeParse(readJsonColumn(row.report))
    if (!report.success) return c.json(fail('INTERNAL', 'The stored scan report cannot be read.'), 500)
    return c.json(ok(report.data))
  })

  return app
}
