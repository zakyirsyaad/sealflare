import { z } from 'zod'
import {
  ScanReport,
  SandboxResult,
  TargetDetail,
  TargetSummary,
} from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { signalOfTallies, type SignalTally } from './signal'

/**
 * The read model of the targets the indexer filled.
 *
 * The internal answers carry `tier: null`. The tier is read from `Core.tierOf` and never
 * computed here, so the public API fills it after it has read the chain. Everything else is
 * already indexed, so the internal service answers it from the database.
 */

/** The tier a target that was never rated has. */
const UNRATED = 'UNRATED'

/** Whether the value is an object, so a field can be added to it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The list of targets, with the tier still empty.
 *
 * The frozen read model asks for a tier, so the answer is checked with the tier of a target
 * that was never rated, and the tier is emptied again afterwards. Every other field, including
 * the rule that the source has to match the target type, is checked by the frozen schema.
 */
export const InternalTargetSummary = z.preprocess(
  (value) => (isRecord(value) ? { ...value, tier: UNRATED } : value),
  TargetSummary.transform((summary) => ({ ...summary, tier: null })),
)

/** The detail of one target, with the tier still empty. */
export const InternalTargetDetail = z.preprocess(
  (value) => (isRecord(value) ? { ...value, tier: UNRATED } : value),
  TargetDetail.transform((detail) => ({ ...detail, tier: null })),
)

/** The filters both list routes share. */
export interface TargetFilters {
  type?: string
  address?: string
}

/** The columns of a target row, as Postgres hands them back. */
interface TargetRow {
  target_id: string
  target_type: string
  label: string
  src: string | null
  codehash: string | null
  bundle_hash: string | null
  publisher: string | null
  publisher_role: string
  bond: unknown
  active_flags: number
  has_delegatecall: boolean
  active_challenge_id: string | null
  safe_count: number
  caution_count: number
  danger_count: number
  last_vote_at: Date | string | null
}

/** The columns of an attestation row, as Postgres hands them back. */
interface AttestationDbRow {
  tx_hash: string
  guardian: string
  verdict: string
  flags: number
  weight: number
  attestation_index: number
  safe_ordinal: number
  short_proof: string
  evidence_uri: string
  cast_during_dispute: boolean
  settled: boolean
  at: Date | string
}

const TARGET_COLUMNS = `t.target_id, t.target_type, t.label, t.src, t.codehash, t.bundle_hash,
       t.publisher, t.publisher_role, t.bond, t.active_flags, t.has_delegatecall,
       t.active_challenge_id, t.safe_count, t.caution_count, t.danger_count, t.last_vote_at`

/** The newest vote first, and the target id to break a tie. Every list route uses this order. */
const ORDER = 'ORDER BY t.last_vote_at DESC NULLS LAST, t.target_id ASC'

/**
 * The same filters for every list route: the target type, and an address that attested.
 *
 * The guardian of a vote is stored the way the chain handed it over, in lower case, so the
 * address filter is compared in lower case as well.
 */
const FILTERS = `WHERE ($1::text IS NULL OR t.target_type = $1)
  AND ($2::text IS NULL OR EXISTS (
    SELECT 1 FROM attestations a WHERE a.target_id = t.target_id AND a.guardian = $2))`

/** The most candidates one answer may carry. */
export const TIER_CANDIDATE_LIMIT = 500

/** Too many candidates for one answer. The caller has to narrow the filters. */
export class TooManyCandidatesError extends Error {
  constructor() {
    super(`there are more than ${TIER_CANDIDATE_LIMIT} candidates, so the filters have to be narrower`)
    this.name = 'TooManyCandidatesError'
  }
}

/** A whole number as a decimal string, whatever the driver handed back. */
export function decimalString(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return BigInt(Math.trunc(value)).toString()
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  throw new Error(`the value ${String(value)} is not a whole number`)
}

/** A timestamp as an ISO string, whatever the driver handed back. */
export function isoDate(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return date.toISOString()
}

/** Postgres and PGlite hand a jsonb column back as an object, but a driver may hand back text. */
export function jsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** The summary of one target row, before the tier is filled. */
export interface Summary {
  targetId: string
  targetType: string
  label: string
  src: string | null
  tier: null
  safe: number
  caution: number
  danger: number
  publisherRole: string
  bond: string
  lastVoteAt: string | null
}

/** The summary of one target row. */
export function summaryOf(row: TargetRow): Summary {
  return {
    targetId: row.target_id,
    targetType: row.target_type,
    label: row.label,
    src: row.src,
    tier: null,
    safe: row.safe_count,
    caution: row.caution_count,
    danger: row.danger_count,
    publisherRole: row.publisher_role,
    bond: decimalString(row.bond),
    lastVoteAt: isoDate(row.last_vote_at),
  }
}

/**
 * Runs the reads of one answer in one snapshot.
 *
 * Postgres gives every statement in a transaction its own snapshot by default, so the rows and
 * the block they were read at could come from two different moments. The isolation level is
 * raised before the first read, and then every read of the answer sees the same database.
 */
export async function snapshot<T>(sql: Db, work: (tx: Db) => Promise<T>): Promise<T> {
  return sql.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    return work(tx)
  })
}

/**
 * The last final block the indexer has read.
 *
 * There is one cursor row per indexed contract. Today only the Core contract is indexed, so the
 * highest block is the Core block. When the court and the vault are indexed as well, this has to
 * name the cursor of the Core contract, because the rows of this read model come from there.
 */
export async function finalizedBlock(sql: Db): Promise<string> {
  const rows = await sql.query<{ last_block: unknown }>('SELECT max(last_block) AS last_block FROM cursor')
  const block = rows[0]?.last_block
  return block === null || block === undefined ? '0' : decimalString(block)
}

/** One page of the target list. */
export async function listTargets(
  sql: Db,
  filters: TargetFilters,
  page: number,
  limit: number,
): Promise<{ items: Summary[]; total: number }> {
  const total = await countTargets(sql, filters)
  const rows = await sql.query<TargetRow>(
    `SELECT ${TARGET_COLUMNS} FROM targets t ${FILTERS} ${ORDER}
     LIMIT $3 OFFSET $4`,
    [filters.type ?? null, filters.address ?? null, limit, (page - 1) * limit],
  )
  return { items: rows.map(summaryOf), total }
}

/**
 * How many targets the filters match.
 *
 * The count is read on its own, so a page past the end of the list still names the real total
 * instead of an empty one.
 */
async function countTargets(sql: Db, filters: TargetFilters): Promise<number> {
  const rows = await sql.query<{ total: unknown }>(
    `SELECT count(*)::int AS total FROM targets t ${FILTERS}`,
    [filters.type ?? null, filters.address ?? null],
  )
  return Number(decimalString(rows[0]?.total ?? 0))
}

/**
 * Every target that still needs its tier, in the order of the list.
 *
 * One more row than the limit is read, so the answer knows that there are too many candidates
 * without counting all of them.
 */
export async function tierCandidates(sql: Db, filters: TargetFilters): Promise<Summary[]> {
  const rows = await sql.query<TargetRow>(
    `SELECT ${TARGET_COLUMNS} FROM targets t ${FILTERS} ${ORDER} LIMIT $3`,
    [filters.type ?? null, filters.address ?? null, TIER_CANDIDATE_LIMIT + 1],
  )
  if (rows.length > TIER_CANDIDATE_LIMIT) throw new TooManyCandidatesError()
  return rows.map(summaryOf)
}

/** The detail of one target, or null when the database does not have it. */
export async function targetDetail(sql: Db, targetId: string): Promise<unknown | null> {
  const rows = await sql.query<TargetRow>(
    `SELECT ${TARGET_COLUMNS} FROM targets t WHERE t.target_id = $1`,
    [targetId],
  )
  const row = rows[0]
  if (!row) return null

  const signal = await signalOfTarget(sql, targetId)
  const count = await sql.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM attestations WHERE target_id = $1',
    [targetId],
  )
  const scan = await readScan(sql, targetId)
  const sandbox = await readSandbox(sql, row.bundle_hash)

  return {
    ...summaryOf(row),
    publisher: row.publisher,
    // A skill has no codehash, and the read model asks for one. The zero hash is the empty one.
    pinnedCodehash: row.codehash ?? `0x${'0'.repeat(64)}`,
    hasDelegatecall: row.has_delegatecall,
    activeFlags: row.active_flags,
    signal,
    activeChallengeId: row.active_challenge_id,
    attestationCount: count[0]?.count ?? 0,
    scan,
    sandbox,
  }
}

/** One page of the attestations of a target. */
export async function listAttestations(
  sql: Db,
  targetId: string,
  page: number,
  limit: number,
): Promise<{ items: unknown[]; total: number }> {
  const total = await countAttestations(sql, targetId)
  const rows = await sql.query<AttestationDbRow>(
    `SELECT tx_hash, guardian, verdict, flags, weight, attestation_index, safe_ordinal, short_proof,
       evidence_uri, cast_during_dispute, settled, at
     FROM attestations WHERE target_id = $1
     ORDER BY attestation_index ASC, tx_hash ASC LIMIT $2 OFFSET $3`,
    [targetId, limit, (page - 1) * limit],
  )
  const items = rows.map((row) => ({
    index: row.attestation_index,
    guardian: row.guardian,
    verdict: row.verdict,
    flags: row.flags,
    weight: row.weight,
    safeOrdinal: row.safe_ordinal,
    shortProof: row.short_proof,
    evidenceURI: row.evidence_uri,
    txHash: row.tx_hash,
    at: isoDate(row.at),
    settled: row.settled,
    castDuringDispute: row.cast_during_dispute,
  }))
  return { items, total }
}

/** How many votes a target has. It is read on its own, so an empty page still names the total. */
async function countAttestations(sql: Db, targetId: string): Promise<number> {
  const rows = await sql.query<{ total: unknown }>(
    'SELECT count(*)::int AS total FROM attestations WHERE target_id = $1',
    [targetId],
  )
  return Number(decimalString(rows[0]?.total ?? 0))
}

/**
 * The signal of a target, from the votes the indexer stored.
 *
 * The votes are grouped in the database, so a target with many votes does not turn into many
 * rows in the answer.
 */
async function signalOfTarget(sql: Db, targetId: string): Promise<unknown> {
  const rows = await sql.query<SignalTally>(
    `SELECT verdict, weight, count(*)::int AS votes, sum(weight)::int AS "totalWeight",
       bit_or(flags)::int AS flags
     FROM attestations WHERE target_id = $1 GROUP BY verdict, weight`,
    [targetId],
  )
  return signalOfTallies(rows)
}

/** The last scan of a target, when there is one. */
async function readScan(sql: Db, targetId: string): Promise<unknown | null> {
  const rows = await sql.query<{ report: unknown }>('SELECT report FROM scan_cache WHERE target_id = $1', [
    targetId,
  ])
  const row = rows[0]
  if (!row) return null
  const report = ScanReport.safeParse(jsonColumn(row.report))
  if (!report.success) throw new Error('the stored scan report cannot be read')
  return report.data
}

/**
 * The last sandbox result of a skill.
 *
 * A failed result is kept forever, so a fuzz failure is never hidden by a clean result that came
 * later. The failure comes first, and only then the newest result. A result that is still
 * `INCOMPLETE` is not a clean result, so the newest result of all is shown in that case.
 *
 * The cache holds one result per probe set version and per model. The newest of them is shown,
 * because the internal service does not know which probe set is the current one.
 */
async function readSandbox(sql: Db, bundleHash: string | null): Promise<unknown | null> {
  if (!bundleHash) return null
  const rows = await sql.query<{ result: unknown }>(
    `SELECT result FROM sandbox_cache WHERE bundle_hash = $1
     ORDER BY (status = 'SANDBOX_FUZZ_FAILED') DESC NULLS LAST, created_at DESC LIMIT 1`,
    [bundleHash],
  )
  const row = rows[0]
  if (!row) return null
  const result = SandboxResult.safeParse(jsonColumn(row.result))
  if (!result.success) throw new Error('the stored sandbox result cannot be read')
  return result.data
}
