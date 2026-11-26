import 'server-only'
import type { Hex } from 'viem'
import type { TrustTier } from '@sealflare/shared/rules'
import { TargetDetail, TargetSummary } from '@sealflare/shared/schemas'
import { getChainReader, type ChainReader } from './chain'
import { DEADLINE_MS, withDeadline } from './deadline'

/**
 * How many tier reads are sent at the same time.
 *
 * The reads of a batch leave in one request, because the transport of the chain puts the calls
 * that come at the same time into one request.
 */
const BATCH = 100

/**
 * The tier of one target, read from Core.
 *
 * The tier is never computed from the indexed rows, because Core is the only place that knows
 * how the votes, the dispute and the publisher add up.
 */
export async function tierOfTarget(reader: ChainReader, targetId: Hex): Promise<TrustTier> {
  return reader.tierAt(targetId, await reader.tierBlockNumber())
}

/**
 * The tier of every target, read at one block.
 *
 * The block is read once, so all the tiers of one answer come from the same moment of the chain
 * and cannot disagree about how old they are.
 *
 * The reads stop when the deadline passes, so a list of many targets does not keep the chain
 * busy after the answer has gone out.
 */
export async function tiersAt(
  reader: ChainReader,
  targetIds: readonly Hex[],
  deadlineAt: number,
): Promise<Map<string, TrustTier>> {
  const tiers = new Map<string, TrustTier>()
  if (targetIds.length === 0) return tiers
  const block = await reader.tierBlockNumber()
  for (let start = 0; start < targetIds.length; start += BATCH) {
    if (Date.now() >= deadlineAt) throw new Error('The deadline of the request passed.')
    const batch = targetIds.slice(start, start + BATCH)
    const values = await Promise.all(batch.map(targetId => reader.tierAt(targetId, block)))
    batch.forEach((targetId, index) => {
      const tier = values[index]
      if (tier !== undefined) tiers.set(targetId.toLowerCase(), tier)
    })
  }
  return tiers
}

/**
 * The rows of the list with the tier of Core filled in.
 *
 * Null when a tier cannot be read: a row with a guessed tier is never answered, because a tier
 * that is wrong is worse than no answer at all. The deadline of the request is the deadline of
 * the route, so this only reads the tiers.
 */
export async function withTiers(items: readonly TargetSummary[]): Promise<TargetSummary[] | null> {
  let tiers: Map<string, TrustTier>
  const deadlineAt = Date.now() + DEADLINE_MS
  try {
    tiers = await withDeadline(tiersAt(getChainReader(), items.map(item => item.targetId as Hex), deadlineAt))
  } catch (error) {
    console.error('The trust tier could not be read.', error instanceof Error ? error.name : 'unknown')
    return null
  }
  const filled: TargetSummary[] = []
  for (const item of items) {
    const tier = tiers.get(item.targetId.toLowerCase())
    if (tier === undefined) {
      console.error('The trust tier of a target is missing.', 'Error')
      return null
    }
    const parsed = TargetSummary.safeParse({ ...item, tier })
    if (!parsed.success) return null
    filled.push(parsed.data)
  }
  return filled
}

/**
 * One target with the tier of Core filled in, or null when the tier cannot be read.
 *
 * The read has a deadline of its own, so a target page never waits for a chain that does not
 * answer.
 */
export async function withTier(detail: TargetDetail): Promise<TargetDetail | null> {
  let tier: TrustTier
  try {
    tier = await withDeadline(tierOfTarget(getChainReader(), detail.targetId))
  } catch (error) {
    console.error('The trust tier could not be read.', error instanceof Error ? error.name : 'unknown')
    return null
  }
  const parsed = TargetDetail.safeParse({ ...detail, tier })
  return parsed.success ? parsed.data : null
}
