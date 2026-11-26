import { z } from 'zod'
import type { TargetType } from '@sealflare/shared/rules'
import { AddressSchema, GuardianDetail, GuardianSummary, TargetSummary } from '@sealflare/shared/schemas'
import type { Verdict } from '../verdict'
import { ApiError } from './client'

/**
 * The list routes of the public API, called from the browser.
 *
 * Every answer arrives in an envelope, so a failure of the service is an error and never an
 * empty list. A list that hides a failure would look like a registry without targets.
 */

/** The block a list was read at, and the page of the list. */
const Meta = z.object({
  finalizedBlock: z.string().optional(),
  page: z.object({ total: z.number().int().min(0), page: z.number().int().min(1), limit: z.number().int().min(1) }).optional(),
})

const Answer = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  meta: Meta.optional(),
})

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

/** Reads a route of the public API and returns the data it holds. */
async function get<T>(path: string, data: z.ZodType<T>): Promise<{ data: T; meta: z.infer<typeof Meta> }> {
  let response: Response
  try {
    response = await fetch(path, { headers: { accept: 'application/json' } })
  } catch {
    throw new ApiError('INTERNAL', 'The registry could not be reached.')
  }
  const payload = await response.json().catch(() => null)
  const answer = Answer.safeParse(payload)
  if (!answer.success) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
  if (!answer.data.success) {
    const error = answer.data.error
    if (!error) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
    throw new ApiError(error.code, error.message)
  }
  const parsed = data.safeParse(answer.data.data)
  if (!parsed.success) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
  return { data: parsed.data, meta: answer.data.meta ?? {} }
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
  const answer = await get(`/api/targets?${params.toString()}`, z.object({ items: TargetSummary.array() }))
  const total = answer.meta.page?.total
  if (total === undefined) throw new ApiError('INTERNAL', 'The target list could not be read.')
  return { items: answer.data.items, total, finalizedBlock: answer.meta.finalizedBlock ?? null }
}

/** The Guardians of the registry, the ones with the highest score first. */
export async function loadGuardians(query: { page: number; limit: number }): Promise<ListAnswer<GuardianSummary>> {
  const params = pageQuery(query.page, query.limit)
  const answer = await get(`/api/guardians?${params.toString()}`, z.object({ items: GuardianSummary.array() }))
  const total = answer.meta.page?.total
  if (total === undefined) throw new ApiError('INTERNAL', 'The guardian list could not be read.')
  return { items: answer.data.items, total, finalizedBlock: answer.meta.finalizedBlock ?? null }
}

/** One Guardian, with the history of what it did. */
export async function loadGuardian(address: string): Promise<OneAnswer<GuardianDetail>> {
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) throw new ApiError('NOT_FOUND', 'There is no such Guardian.')
  const answer = await get(`/api/guardians/${encodeURIComponent(parsed.data)}`, GuardianDetail)
  return { item: answer.data, finalizedBlock: answer.meta.finalizedBlock ?? null }
}
