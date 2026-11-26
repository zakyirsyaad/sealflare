import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AddressSchema, BountyDetail, BountySummary, Bytes32Schema } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, okWithMeta } from '../respond'
import { finalizedBlock, snapshot } from '../readModel/targets'
import { bountyDetail, listBounties } from '../readModel/bounties'

/**
 * The read routes of the bounties the Vault brought.
 *
 * A bounty is keyed by the target it was made for, so the list can be narrowed to one target or
 * to the bounties of one account.
 */

/** The query of the bounty list. */
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  targetId: Bytes32Schema.optional(),
  requester: AddressSchema.optional(),
})

/** The default size of a page. */
const DEFAULT_LIMIT = 20

const BountyParam = z.object({ id: z.string().min(1) })

export interface BountyRouteDeps {
  sql: Db
}

export function bountyRoutes(deps: BountyRouteDeps): Hono {
  const app = new Hono()
  app.get('/', (c) => listHandler(c, deps))
  app.get('/:id', (c) => detailHandler(c, deps))
  return app
}

/** The list of the bounties, the open ones first. */
async function listHandler(c: Context, deps: BountyRouteDeps): Promise<Response> {
  const query = readListQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the bounty list is not valid.'), 400)
  }
  const { page, limit, filters } = query.value
  const { items, total, block } = await snapshot(deps.sql, async (tx) => {
    const list = await listBounties(tx, filters, page, limit)
    return { ...list, block: await finalizedBlock(tx) }
  })
  const parsed = BountySummary.array().safeParse(items)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed bounties cannot be read.'), 500)
  return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
}

/** One bounty, with the slots it filled. */
async function detailHandler(c: Context, deps: BountyRouteDeps): Promise<Response> {
  const params = BountyParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The id of the bounty is not valid.'), 400)
  }
  const { detail, block } = await snapshot(deps.sql, async (tx) => {
    const found = await bountyDetail(tx, params.data.id)
    return { detail: found, block: await finalizedBlock(tx) }
  })
  if (!detail) return c.json(fail('NOT_FOUND', 'There is no such bounty.'), 404)
  const parsed = BountyDetail.safeParse(detail)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed bounty cannot be read.'), 500)
  return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
}

/** Reads the query of the bounty list, or the reason it cannot be read. */
function readListQuery(c: Context): {
  ok: true
  value: { page: number; limit: number; filters: { targetId?: string; requester?: string } }
} | {
  ok: false
} {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({
    page: raw.page,
    limit: raw.limit,
    targetId: raw.targetId,
    requester: raw.requester,
  })
  if (!parsed.success) return { ok: false }
  return {
    ok: true,
    value: {
      page: parsed.data.page ?? 1,
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      filters: { targetId: parsed.data.targetId, requester: parsed.data.requester },
    },
  }
}
