import { Hono } from 'hono'
import { z } from 'zod'
import { Bytes32Schema, ScanReport, encodeSrc } from '@sealflare/shared/schemas'
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
    // byte for byte copy of the folder in another repository is the same target. The source of
    // a skill is pinned with the first scan, so a copy never takes the place of the publisher's
    // repository in the header and the link. The scan itself is still answered, because the
    // caller scanned it.
    const src = encodeSrc(report.data.source)
    const stored = await deps.sql.query<{ src: string | null }>(
      'SELECT src FROM scan_cache WHERE target_id = $1',
      [params.data.targetId],
    )
    const pinned = stored[0]?.src ?? null
    if (pinned !== null && !sameRepository(pinned, src)) {
      console.warn('a scan of another repository was not cached', { targetId: params.data.targetId })
      return c.json(ok(report.data))
    }

    // A scan that started earlier can arrive later than a newer one, so the row is only
    // replaced by a report that is at least as new as the one that is stored.
    await deps.sql.query(
      `INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (target_id) DO UPDATE
         SET src = EXCLUDED.src, report = EXCLUDED.report, scanned_at = EXCLUDED.scanned_at
       WHERE scan_cache.scanned_at <= EXCLUDED.scanned_at`,
      [params.data.targetId, src, JSON.stringify(report.data), report.data.scannedAt],
    )
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
