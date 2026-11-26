import { z } from 'zod'
import type { TargetType } from '@sealflare/shared/rules'
import {
  AddressSchema,
  GuardianDetailResponse,
  GuardiansListResponse,
  ResponseMeta,
  TargetsListResponse,
  type GuardianDetail,
  type GuardianSummary,
  type TargetSummary,
} from '@sealflare/shared/schemas'
import type { Verdict } from '../verdict'
import { ApiError } from './client'

/**
 * The list routes of the public API, called from the browser.
 *
 * Every answer arrives in an envelope, so a failure of the service is an error and never an
 * empty list. A list that hides a failure would look like a registry without targets.
 */

/** One page of a list, with the total the server counted. */
export type ListAnswer<T> = {
  items: T[]
  total: number
  finalizedBlock: string | null
}

/** One row, with the block it was read at. */
export type OneAnswer<T> = {
  item: T
  finalizedBlock: string | null
}

/** The shape of an answer that carries data, or the error that says why it does not. */
type AnswerShape<D> =
  | { success: true; data: D; meta?: z.infer<typeof ResponseMeta> }
  | { success: false; error: { code: string; message: string } }

/** Reads a route of the public API and returns the data it holds. */
async function get<D>(
  path: string,
  schema: z.ZodType<AnswerShape<D>>,
): Promise<{ data: D; meta: z.infer<typeof ResponseMeta> }> {
  let response: Response
  try {
    response = await fetch(path, { headers: { accept: 'application/json' } })
  } catch {
    throw new ApiError('INTERNAL', 'The registry could not be reached.')
  }
  const payload = await response.json().catch(() => null)
  // The answer is read with the frozen schema of the route, so an answer that does not fit it
  // is refused instead of shown.
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
  const answer = parsed.data
  if (!answer.success) throw new ApiError(answer.error.code, answer.error.message)
  return { data: answer.data, meta: answer.meta ?? {} }
}

/** The query of a page of a list. */
function pageQuery(page: number, limit: number): URLSearchParams {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  return params
}

/**
 * The targets of the registry, with the tier of Core filled in.
 *
 * The tier comes from the API, which reads it from the chain, so it is never a number the
 * indexer computed.
 */
export async function loadTargets(query: {
  page: number
  limit: number
  type?: TargetType
  verdict?: Verdict
}): Promise<ListAnswer<TargetSummary>> {
  const params = pageQuery(query.page, query.limit)
  if (query.type !== undefined) params.set('type', query.type)
  if (query.verdict !== undefined) params.set('verdict', query.verdict)
  const answer = await get(`/api/targets?${params.toString()}`, TargetsListResponse)
  const total = answer.meta.page?.total
  if (total === undefined) throw new ApiError('INTERNAL', 'The target list could not be read.')
  return { items: answer.data.items, total, finalizedBlock: answer.meta.finalizedBlock ?? null }
}

/** The Guardians of the registry, the ones with the highest score first. */
export async function loadGuardians(query: { page: number; limit: number }): Promise<ListAnswer<GuardianSummary>> {
  const params = pageQuery(query.page, query.limit)
  const answer = await get(`/api/guardians?${params.toString()}`, GuardiansListResponse)
  const total = answer.meta.page?.total
  if (total === undefined) throw new ApiError('INTERNAL', 'The guardian list could not be read.')
  return { items: answer.data.items, total, finalizedBlock: answer.meta.finalizedBlock ?? null }
}

/** One Guardian, with the history of what it did. */
export async function loadGuardian(address: string): Promise<OneAnswer<GuardianDetail>> {
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) throw new ApiError('NOT_FOUND', 'There is no such Guardian.')
  const answer = await get(`/api/guardians/${encodeURIComponent(parsed.data)}`, GuardianDetailResponse)
  return { item: answer.data, finalizedBlock: answer.meta.finalizedBlock ?? null }
}
