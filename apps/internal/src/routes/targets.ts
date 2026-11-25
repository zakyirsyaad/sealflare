import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AddressSchema, AttestationRow, Bytes32Schema, TargetTypeSchema } from '@sealflare/shared/schemas'
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
  snapshot,
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

/** The query of the candidate route. It has no page, because it returns every candidate. */
const CandidateQuery = z.object({
  type: TargetTypeSchema.optional(),
  address: AddressSchema.optional(),
})

/** The query of the attestation list. Only the page and the limit mean something there. */
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** The default size of a page. */
const DEFAULT_LIMIT = 20

const TargetIdParam = z.object({ targetId: Bytes32Schema })

export interface TargetRouteDeps {
  sql: Db
}

export function targetRoutes(deps: TargetRouteDeps): Hono {
  const app = new Hono()
  app.get('/', (c) => listHandler(c, deps))
  app.get('/tier-candidates', (c) => candidatesHandler(c, deps))
  app.get('/:targetId', (c) => detailHandler(c, deps))
  app.get('/:targetId/attestations', (c) => attestationsHandler(c, deps))
  return app
}

/** The list of the targets, newest vote first. */
async function listHandler(c: Context, deps: TargetRouteDeps): Promise<Response> {
  const query = readListQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the target list is not valid.'), 400)
  }
  const { page, limit, filters } = query.value
  // The rows and the block they were read at come from one snapshot.
  const { items, total, block } = await snapshot(deps.sql, async (tx) => {
    const list = await listTargets(tx, filters, page, limit)
    return { ...list, block: await finalizedBlock(tx) }
  })
  const parsed = InternalTargetSummary.array().safeParse(items)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed targets cannot be read.'), 500)
  return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
}

/** Every target that still needs its tier. */
async function candidatesHandler(c: Context, deps: TargetRouteDeps): Promise<Response> {
  const query = readCandidateQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the candidate list is not valid.'), 400)
  }
  try {
    // The candidates and the cursor come from one snapshot, so the answer cannot show a
    // candidate that is not there any more while it names the block it was read at.
    const { items, block } = await snapshot(deps.sql, async (tx) => {
      const candidates = await tierCandidates(tx, query.value)
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
}

/** One target, with its signal, its scan and its sandbox result. */
async function detailHandler(c: Context, deps: TargetRouteDeps): Promise<Response> {
  const params = TargetIdParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)
  }
  const { detail, block } = await snapshot(deps.sql, async (tx) => {
    const found = await targetDetail(tx, params.data.targetId)
    return { detail: found, block: await finalizedBlock(tx) }
  })
  if (!detail) return c.json(fail('NOT_FOUND', 'There is no such target.'), 404)
  const parsed = InternalTargetDetail.safeParse(detail)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed target cannot be read.'), 500)
  return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
}

/** The votes of a target, in the order the contract numbered them. */
async function attestationsHandler(c: Context, deps: TargetRouteDeps): Promise<Response> {
  const params = TargetIdParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The target id is not a 32 byte hex value.'), 400)
  }
  const query = readPageQuery(c)
  if (!query.ok) {
    return c.json(fail('BAD_REQUEST', 'The query of the attestation list is not valid.'), 400)
  }
  const { page, limit } = query.value
  const { items, total, block, found } = await snapshot(deps.sql, async (tx) => {
    const exists = await targetExists(tx, params.data.targetId)
    if (!exists) return { items: [], total: 0, block: await finalizedBlock(tx), found: false }
    const list = await listAttestations(tx, params.data.targetId, page, limit)
    return { ...list, block: await finalizedBlock(tx), found: true }
  })
  if (!found) return c.json(fail('NOT_FOUND', 'There is no such target.'), 404)
  // The votes are checked with the frozen read model, so a row that does not fit it is
  // refused instead of answered.
  const parsed = AttestationRow.array().safeParse(items)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed votes cannot be read.'), 500)
  return c.json(okWithMeta({ items: parsed.data }, { finalizedBlock: block, page: { total, page, limit } }))
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

/** Reads the filters of the candidate route, or the reason they cannot be read. */
function readCandidateQuery(c: Context): { ok: true; value: TargetFilters } | { ok: false } {
  const raw = c.req.query()
  const parsed = CandidateQuery.safeParse({ type: raw.type, address: raw.address })
  if (!parsed.success) return { ok: false }
  return { ok: true, value: { type: parsed.data.type, address: parsed.data.address } }
}

/** Reads the page of a list route, or the reason it cannot be read. */
function readPageQuery(c: Context): { ok: true; value: { page: number; limit: number } } | { ok: false } {
  const raw = c.req.query()
  const parsed = PageQuery.safeParse({ page: raw.page, limit: raw.limit })
  if (!parsed.success) return { ok: false }
  return {
    ok: true,
    value: { page: parsed.data.page ?? 1, limit: parsed.data.limit ?? DEFAULT_LIMIT },
  }
}

/** Whether the database knows the target. */
async function targetExists(sql: Db, targetId: string): Promise<boolean> {
  const rows = await sql.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM targets WHERE target_id = $1) AS found',
    [targetId],
  )
  return rows[0]?.found ?? false
}
