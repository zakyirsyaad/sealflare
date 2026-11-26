import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { Bytes32Schema, ChallengeDetail, ChallengeSummary, UintStringSchema } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, okWithMeta } from '../respond'
import { finalizedBlock, snapshot } from '../readModel/targets'
import { challengeDetail, listChallenges } from '../readModel/challenges'

/**
 * The read routes of the disputes the Court brought.
 *
 * The phase of a dispute is the phase it is in right now, and the direction of a vote is only
 * known after the juror revealed it. The answer never carries a direction that the chain has
 * not published.
 */

/** The query of the dispute list. */
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  targetId: Bytes32Schema.optional(),
})

/** The default size of a page. */
const DEFAULT_LIMIT = 20

const ChallengeParam = z.object({ id: UintStringSchema })

export interface ChallengeRouteDeps {
  sql: Db
  /** The moment the phase of a dispute and its deadlines are read at. */
  now: () => Date
}

export function challengeRoutes(deps: ChallengeRouteDeps): Hono {
  const app = new Hono()
  app.get('/', (c) => listHandler(c, deps))
  app.get('/:id', (c) => detailHandler(c, deps))
  return app
}

/** The list of the disputes, the newest first. */
async function listHandler(c: Context, deps: ChallengeRouteDeps): Promise<Response> {
  const query = readListQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the dispute list is not valid.'), 400)
  }
  const { page, limit, filters } = query.value
  const { items, total, block } = await snapshot(deps.sql, async (tx) => {
    const list = await listChallenges(tx, filters, page, limit, deps.now())
    return { ...list, block: await finalizedBlock(tx) }
  })
  const parsed = ChallengeSummary.array().safeParse(items)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed disputes cannot be read.'), 500)
  return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
}

/** One dispute, with its jury and its payouts. */
async function detailHandler(c: Context, deps: ChallengeRouteDeps): Promise<Response> {
  const params = ChallengeParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The id of the dispute is not a whole number.'), 400)
  }
  const { detail, block } = await snapshot(deps.sql, async (tx) => {
    const found = await challengeDetail(tx, params.data.id, deps.now())
    return { detail: found, block: await finalizedBlock(tx) }
  })
  if (!detail) return c.json(fail('NOT_FOUND', 'There is no such dispute.'), 404)
  const parsed = ChallengeDetail.safeParse(detail)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed dispute cannot be read.'), 500)
  return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
}

/** Reads the query of the dispute list, or the reason it cannot be read. */
function readListQuery(c: Context): {
  ok: true
  value: { page: number; limit: number; filters: { targetId?: string } }
} | {
  ok: false
} {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({ page: raw.page, limit: raw.limit, targetId: raw.targetId })
  if (!parsed.success) return { ok: false }
  return {
    ok: true,
    value: {
      page: parsed.data.page ?? 1,
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      filters: { targetId: parsed.data.targetId },
    },
  }
}
