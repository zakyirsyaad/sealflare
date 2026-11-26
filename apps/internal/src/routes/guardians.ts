import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AddressSchema, GuardianDetail, GuardianSummary } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, okWithMeta } from '../respond'
import { finalizedBlock, snapshot } from '../readModel/targets'
import { guardianDetail, listGuardians } from '../readModel/guardians'

/**
 * The read routes of the guardians the Core knows.
 *
 * A guardian with a penalty that was never charged is marked, so a reader sees that its score
 * still counts a penalty that is waiting.
 */

/** The query of the guardian list. */
const ListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** The default size of a page. */
const DEFAULT_LIMIT = 20

const AddressParam = z.object({ address: AddressSchema })

export interface GuardianRouteDeps {
  sql: Db
}

export function guardianRoutes(deps: GuardianRouteDeps): Hono {
  const app = new Hono()
  app.get('/', (c) => listHandler(c, deps))
  app.get('/:address', (c) => detailHandler(c, deps))
  return app
}

/** The list of the guardians, the ones with the highest score first. */
async function listHandler(c: Context, deps: GuardianRouteDeps): Promise<Response> {
  const query = readListQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the guardian list is not valid.'), 400)
  }
  const { page, limit } = query.value
  const { items, total, block } = await snapshot(deps.sql, async (tx) => {
    const list = await listGuardians(tx, page, limit)
    return { ...list, block: await finalizedBlock(tx) }
  })
  const parsed = GuardianSummary.array().safeParse(items)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed guardians cannot be read.'), 500)
  return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
}

/** One guardian, with its history. */
async function detailHandler(c: Context, deps: GuardianRouteDeps): Promise<Response> {
  const params = AddressParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The address of the guardian is not valid.'), 400)
  }
  const { detail, block } = await snapshot(deps.sql, async (tx) => {
    const found = await guardianDetail(tx, params.data.address)
    return { detail: found, block: await finalizedBlock(tx) }
  })
  if (!detail) return c.json(fail('NOT_FOUND', 'There is no such guardian.'), 404)
  const parsed = GuardianDetail.safeParse(detail)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed guardian cannot be read.'), 500)
  return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
}

/** Reads the page of the guardian list, or the reason it cannot be read. */
function readListQuery(c: Context): { ok: true; value: { page: number; limit: number } } | { ok: false } {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({ page: raw.page, limit: raw.limit })
  if (!parsed.success) return { ok: false }
  return { ok: true, value: { page: parsed.data.page ?? 1, limit: parsed.data.limit ?? DEFAULT_LIMIT } }
}
