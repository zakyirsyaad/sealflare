import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AddressSchema, Bytes32Schema, TargetTypeSchema } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, okWithMeta } from '../respond'
import {
  InternalTargetDetail,
  InternalTargetSummary,
  TIER_CANDIDATE_LIMIT,
  TooManyCandidatesError,
  finalizedBlock,
  listAttestations,
  listTargets,
  targetDetail,
  tierCandidates,
  type TargetFilters,
} from '../readModel/targets'

/**
 * The read routes of the targets the indexer filled.
 *
 * Every answer carries the last final block the indexer has read, so the public API can say how
 * fresh the data is. The tier is not filled here: it is read from `Core.tierOf` and never
 * computed from the indexed rows.
 */

/** The query of a list route. The page and the limit are optional, the rest is a filter. */
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  type: TargetTypeSchema.optional(),
  address: AddressSchema.optional(),
})

/** The default size of a page. */
const DEFAULT_LIMIT = 20

const TargetIdParam = z.object({ targetId: Bytes32Schema })

export interface TargetRouteDeps {
  sql: Db
}

/** Reads the query of a list route, or the reason it cannot be read. */
function readListQuery(c: Context): {
  ok: true
  value: { page: number; limit: number; filters: TargetFilters }
} | {
  ok: false
} {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({
    page: raw.page,
    limit: raw.limit,
    type: raw.type,
    address: raw.address,
  })
  if (!parsed.success) return { ok: false }
  return {
    ok: true,
    value: {
      page: parsed.data.page ?? 1,
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      filters: { type: parsed.data.type, address: parsed.data.address },
    },
  }
}

export function targetRoutes(deps: TargetRouteDeps): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    const query = readListQuery(c)
    if (!query.ok) {
      return c.json(fail('BAD_REQUEST', 'The query of the target list is not valid.'), 400)
    }
    const { page, limit, filters } = query.value
    const { items, total } = await listTargets(deps.sql, filters, page, limit)
    const parsed = InternalTargetSummary.array().safeParse(items)
    if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed targets cannot be read.'), 500)
    const block = await finalizedBlock(deps.sql)
    return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
  })

  app.get('/tier-candidates', async (c) => {
    const query = readListQuery(c)
    if (!query.ok) {
      return c.json(fail('BAD_REQUEST', 'The query of the candidate list is not valid.'), 400)
    }
    try {
      // The candidates and the cursor come from one snapshot, so the answer cannot show a
      // candidate that is not there any more while it names the block it was read at.
      const { items, block } = await deps.sql.transaction(async (tx) => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        const candidates = await tierCandidates(tx, query.value.filters)
        return { items: candidates, block: await finalizedBlock(tx) }
      })
      const parsed = InternalTargetSummary.array().safeParse(items)
      if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed targets cannot be read.'), 500)
      return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block }))
    } catch (error) {
      if (error instanceof TooManyCandidatesError) {
        return c.json(
          fail('INTERNAL', `There are more than ${TIER_CANDIDATE_LIMIT} candidates, so the filters have to be narrower.`),
          503,
        )
      }
      throw error
    }
  })

  app.get('/:targetId', async (c) => {
    const params = TargetIdParam.safeParse(c.req.param())
    if (!params.success) {
      return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)
    }
    const detail = await targetDetail(deps.sql, params.data.targetId)
    if (!detail) return c.json(fail('NOT_FOUND', 'There is no such target.'), 404)
    const parsed = InternalTargetDetail.safeParse(detail)
    if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed target cannot be read.'), 500)
    const block = await finalizedBlock(deps.sql)
    return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
  })

  app.get('/:targetId/attestations', async (c) => {
    const params = TargetIdParam.safeParse(c.req.param())
    if (!params.success) {
      return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)
    }
    const query = readListQuery(c)
    if (!query.ok) {
      return c.json(fail('BAD_REQUEST', 'The query of the attestation list is not valid.'), 400)
    }
    const { page, limit } = query.value
    if (!(await targetExists(deps.sql, params.data.targetId))) {
      return c.json(fail('NOT_FOUND', 'There is no such target.'), 404)
    }
    const { items, total } = await listAttestations(deps.sql, params.data.targetId, page, limit)
    const block = await finalizedBlock(deps.sql)
    return c.json(okWithMeta({ items }, { finalizedBlock: block, page: { total, page, limit } }))
  })

  return app
}

/** Whether the database knows the target. */
async function targetExists(sql: Db, targetId: string): Promise<boolean> {
  const rows = await sql.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM targets WHERE target_id = $1) AS found',
    [targetId],
  )
  return rows[0]?.found ?? false
}
