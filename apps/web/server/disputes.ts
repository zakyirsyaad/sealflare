import 'server-only'
import { Bytes32Schema, ChallengeDetail, ChallengeSummary, UintStringSchema } from '@sealflare/shared/schemas'
import { ZERO_ADDRESS } from '@sealflare/shared/rules'
import { getChainReader } from './chain'
import { internalGet, InternalServiceError } from './internal'

/**
 * What the dispute pages read.
 *
 * The rows come from the internal service, the only door to the database. A failure of that
 * service is a failure and never an empty answer, so a reader never sees a Court that looks
 * empty because the service was down. The publisher of the target comes from the registry, not
 * from the index, because only the registry knows whether the publisher is verified.
 */

/** The default size of a page of disputes. */
const PAGE_SIZE = 20

export type PublisherRole = 'NONE' | 'THIRD_PARTY_SPONSOR' | 'VERIFIED_PUBLISHER'

export type DisputePageData = {
  detail: ChallengeDetail | null
  /** Null when the registry could not be read, which is not the same as no publisher. */
  publisherRole: PublisherRole | null
  publisher: string | null
  failed: boolean
}

export type DisputeListData = {
  items: ChallengeSummary[]
  total: number
  failed: boolean
}

const missing: DisputePageData = { detail: null, publisherRole: 'NONE', publisher: null, failed: false }
const unreadable: DisputePageData = { detail: null, publisherRole: null, publisher: null, failed: true }

/**
 * Takes the direction of every vote away while the index says the commit phase, whatever its rows
 * hold, so the page never carries a direction that the chain has not published.
 */
function hideTheVotesOfTheCommitPhase(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const challenge = value as { phase?: unknown; jurors?: unknown }
  if (challenge.phase !== 'COMMIT' || !Array.isArray(challenge.jurors)) return value
  return {
    ...challenge,
    jurors: challenge.jurors.map(juror =>
      juror !== null && typeof juror === 'object' && !Array.isArray(juror) ? { ...(juror as object), uphold: null } : juror,
    ),
  }
}

/** The publisher and the role the registry holds for a target. */
async function readPublisher(targetId: string): Promise<Pick<DisputePageData, 'publisherRole' | 'publisher'>> {
  try {
    const target = await getChainReader().target(targetId as `0x${string}`)
    if (target === null) return { publisherRole: 'NONE', publisher: null }
    const bound = target.publisher.toLowerCase() !== ZERO_ADDRESS
    return { publisherRole: bound ? target.publisherRole : 'NONE', publisher: bound ? target.publisher : null }
  } catch {
    return { publisherRole: null, publisher: null }
  }
}

/** One dispute with its jury and payouts, and what the registry says about the publisher. */
export async function loadDispute(id: string): Promise<DisputePageData> {
  const parsedId = UintStringSchema.safeParse(id)
  if (!parsedId.success) return missing
  let raw: unknown
  try {
    raw = (await internalGet<unknown>(`/challenges/${parsedId.data}`)).data
  } catch (error) {
    if (error instanceof InternalServiceError && error.code === 'NOT_FOUND') return missing
    return unreadable
  }
  const parsed = ChallengeDetail.safeParse(hideTheVotesOfTheCommitPhase(raw))
  if (!parsed.success) return unreadable
  return { detail: parsed.data, failed: false, ...(await readPublisher(parsed.data.targetId)) }
}

/** The rows of one page of the list, or null when they cannot be read. */
async function readPage(query: Record<string, string | number>): Promise<{ items: ChallengeSummary[]; total: number } | null> {
  try {
    const answer = await internalGet<{ items: unknown[] }>('/challenges', query)
    const items = ChallengeSummary.array().safeParse(answer.data.items)
    if (!items.success) return null
    return { items: items.data, total: answer.meta.page?.total ?? items.data.length }
  } catch {
    return null
  }
}

/** One page of the disputes, the newest first. */
export async function loadDisputes(page = 1): Promise<DisputeListData> {
  const read = await readPage({ page, limit: PAGE_SIZE })
  return read === null ? { items: [], total: 0, failed: true } : { ...read, failed: false }
}

/** The disputes of one target, or null when they cannot be read. */
export async function loadChallengesOf(targetId: string): Promise<ChallengeSummary[] | null> {
  if (!Bytes32Schema.safeParse(targetId).success) return null
  const read = await readPage({ page: 1, limit: PAGE_SIZE, targetId })
  return read === null ? null : read.items
}
