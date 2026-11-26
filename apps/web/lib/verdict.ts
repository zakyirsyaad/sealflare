import { z } from 'zod'
import type { TrustTier } from '@sealflare/shared/rules'

/**
 * The three verdicts a reader can filter the target list by.
 *
 * A target shows one trust tier, and the tiers fall into the three verdicts people read them
 * as: safe, caution and danger. The tiers themselves are never copied here, they are the ones
 * of the frozen rules.
 */
export const VERDICTS = ['SAFE', 'CAUTION', 'DANGER'] as const
export type Verdict = (typeof VERDICTS)[number]

/** The verdict of a filter, checked at the boundary of the API. */
export const VerdictSchema = z.enum(VERDICTS)

/** The trust tiers that belong to each verdict. */
export const VERDICT_TIERS: Record<Verdict, readonly TrustTier[]> = {
  SAFE: ['COMMUNITY_SAFE', 'WARRANTY_BACKED_SAFE'],
  CAUTION: ['CAUTION_FLAGGED', 'DISPUTED_CAUTION', 'STALE_CODEHASH_DRIFT'],
  DANGER: ['CONFIRMED_DANGER'],
}
