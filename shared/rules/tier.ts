export const TRUST_TIERS = [
  'UNRATED',
  'COMMUNITY_SAFE',
  'WARRANTY_BACKED_SAFE',
  'CAUTION_FLAGGED',
  'DISPUTED_CAUTION',
  'CONFIRMED_DANGER',
  'STALE_CODEHASH_DRIFT',
] as const
export type TrustTier = (typeof TRUST_TIERS)[number]

export type TierInput = {
  confirmedDanger: boolean
  codehashDrift: boolean
  activeDispute: boolean
  safeWeight: number
  cautionWeight: number
  dangerWeight: number
  proxyMarker: boolean
  verifiedPublisherBond: boolean
}

export const SAFE_WEIGHT_THRESHOLD = 3
export const DANGER_WEIGHT_THRESHOLD = 3

/** Architecture 4.6: eight rules in priority order, first match wins. */
export function tierOf(input: TierInput): TrustTier {
  for (const weight of [input.safeWeight, input.cautionWeight, input.dangerWeight]) {
    // NaN compares false everywhere, which would fall through to a SAFE tier. Refuse instead.
    if (!Number.isInteger(weight) || weight < 0) throw new RangeError('Vote weights must be whole non-negative numbers.')
  }
  const against = input.cautionWeight + input.dangerWeight
  if (input.confirmedDanger) return 'CONFIRMED_DANGER'
  if (input.codehashDrift) return 'STALE_CODEHASH_DRIFT'
  if (input.activeDispute) return 'DISPUTED_CAUTION'
  if (input.dangerWeight >= DANGER_WEIGHT_THRESHOLD || (against > 0 && against >= input.safeWeight)) return 'CAUTION_FLAGGED'
  if (input.proxyMarker) return 'CAUTION_FLAGGED'
  if (input.safeWeight < SAFE_WEIGHT_THRESHOLD) return 'UNRATED'
  return input.verifiedPublisherBond ? 'WARRANTY_BACKED_SAFE' : 'COMMUNITY_SAFE'
}
