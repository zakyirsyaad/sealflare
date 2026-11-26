import { weightOf } from '@sealflare/shared/rules'

/**
 * The standing of an account, read from the chain and not from the indexer.
 *
 * The score and the weight come from the registry contract, so a reader never sees a standing
 * that the chain has already changed.
 */

/** How far the search for the next weight goes. */
const MAX_SCAN_STEPS = 100_000

/**
 * How many points are left to the next weight.
 *
 * The thresholds are not copied here: the next weight is the first score above this one for which
 * the frozen rules give a larger weight, so a change of a threshold there changes the distance
 * here with it. A guardian with the highest weight has no next weight.
 */
export function toNextWeight(score: number): number | null {
  if (!Number.isInteger(score)) return null
  const weight = weightOf(score)
  if (weight === weightOf(Number.MAX_SAFE_INTEGER)) return null
  for (let step = 1; step <= MAX_SCAN_STEPS; step += 1) {
    if (weightOf(score + step) > weight) return step
  }
  return null
}
