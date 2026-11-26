import { VERDICTS, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { VerdictSchema } from '@sealflare/shared/schemas'

/**
 * The three verdicts a reader can filter the target list by.
 *
 * The verdicts themselves are the frozen ones, so the filter of the app and the verdict of a
 * vote can never drift apart. What the app adds is the group of trust tiers behind each of
 * them.
 */
export { VERDICTS, VerdictSchema }
export type { Verdict } from '@sealflare/shared/rules'

/**
 * The trust tiers that belong to each verdict.
 *
 * The three groups cover the seven trust tiers of the frozen rules, so a target is never lost
 * by a filter. `UNRATED` is the tier of a target with too little signal, and doubt is not
 * safe, so it belongs to CAUTION. The tier of a row is still shown as it is, so a reader sees
 * that a row is unrated and not merely flagged.
 */
export const VERDICT_TIERS: Record<Verdict, readonly TrustTier[]> = {
  SAFE: ['COMMUNITY_SAFE', 'WARRANTY_BACKED_SAFE'],
  CAUTION: ['UNRATED', 'CAUTION_FLAGGED', 'DISPUTED_CAUTION', 'STALE_CODEHASH_DRIFT'],
  DANGER: ['CONFIRMED_DANGER'],
}
