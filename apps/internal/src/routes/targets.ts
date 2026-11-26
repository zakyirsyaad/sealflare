import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { AttestationRow, Bytes32Schema, ListQuery } from '@sealflare/shared/schemas'
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
import type { SandboxVersion } from '../readModel/caches'

/**
 * The read routes of the targets the indexer filled.
 *
 * Every answer carries the last final block the indexer has read, so the public API can say how
 * fresh the data is. The tier is not filled here: it is read from `Core.tierOf` and never
 * computed from the indexed rows.
 */

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
  /**
   * The probe set and the model the sandbox runs now.
   *
   * A clean sandbox result expires when either of them changes, so only a result of this version
   * is shown as current. Without the version no clean result is shown at all.
   */
  sandbox?: SandboxVersion | null
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
    return c.json(fail('BAD_REQUEST', listProblemMessage(query.problem)), 400)
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
    return c.json(fail('BAD_REQUEST', listProblemMessage(query.problem)), 400)
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
      // The request asked for a filter that cannot be read in one go. The answer names the
      // reason, so the caller can ask for a narrower filter instead of showing an empty list.
      return c.json(
        fail('BAD_REQUEST', `There are more than ${TIER_CANDIDATE_LIMIT} candidates, so the filters have to be narrower.`),
        400,
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
    const found = await targetDetail(tx, params.data.targetId, deps.sandbox ?? null)
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

/** Why the query of a list route cannot be answered. */
type QueryProblem = 'invalid' | 'tier'

/** The message of a query that cannot be answered. */
function listProblemMessage(problem: QueryProblem): string {
  if (problem === 'tier') return 'The tier filter is not available here. The tier is read from the chain.'
  return 'The query of the target list is not valid.'
}

/**
 * Reads the query of a list route with the shared schema.
 *
 * The shared `ListQuery` is the same one the public API uses, so the two cannot drift apart. The
 * page and the limit arrive as strings, so they are turned into numbers first; a string that is
 * not a number becomes NaN, which the schema refuses.
 *
 * The tier is a filter the internal service cannot answer: the tier is read from the chain and
 * never computed from the indexed rows. A request that asks for it is refused, so the caller
 * knows that the filter was not applied instead of getting the unfiltered list.
 */
function readListQuery(c: Context): {
  ok: true
  value: { page: number; limit: number; filters: TargetFilters }
} | {
  ok: false
  problem: QueryProblem
} {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({
    page: raw.page === undefined ? undefined : Number(raw.page),
    limit: raw.limit === undefined ? undefined : Number(raw.limit),
    type: raw.type,
    address: raw.address,
    tier: raw.tier,
  })
  if (!parsed.success) return { ok: false, problem: 'invalid' }
  if (parsed.data.tier !== undefined) return { ok: false, problem: 'tier' }
  return {
    ok: true,
    value: {
      page: parsed.data.page ?? 1,
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      filters: { type: parsed.data.type, address: parsed.data.address },
    },
  }
}

/**
 * Reads the filters of the candidate route, or the reason they cannot be read.
 *
 * The candidate route uses the same shared schema, so a filter it does not support is refused
 * instead of dropped.
 */
function readCandidateQuery(c: Context): { ok: true; value: TargetFilters } | { ok: false; problem: QueryProblem } {
  const raw = c.req.query()
  const parsed = ListQuery.safeParse({
    type: raw.type,
    address: raw.address,
    tier: raw.tier,
  })
  if (!parsed.success) return { ok: false, problem: 'invalid' }
  if (parsed.data.tier !== undefined) return { ok: false, problem: 'tier' }
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
