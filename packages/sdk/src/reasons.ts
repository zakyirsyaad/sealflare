import type { Address } from 'viem'
import type { FlagName, TrustTier } from '@sealflare/shared/rules'

/** Only these two tiers are safe. Nothing else can produce a safe verdict. */
export function isSafeTier(tier: TrustTier): boolean {
  return tier === 'COMMUNITY_SAFE' || tier === 'WARRANTY_BACKED_SAFE'
}

/** The tier of the registry, in plain English. */
export function tierReason(tier: TrustTier): string {
  switch (tier) {
    case 'UNRATED':
      return 'The registry has not rated this target yet.'
    case 'COMMUNITY_SAFE':
      return 'The registry rates this target as COMMUNITY_SAFE.'
    case 'WARRANTY_BACKED_SAFE':
      return 'The registry rates this target as WARRANTY_BACKED_SAFE.'
    case 'CAUTION_FLAGGED':
      return 'The registry rates this target as CAUTION_FLAGGED.'
    case 'DISPUTED_CAUTION':
      return 'A dispute is open against this target.'
    case 'CONFIRMED_DANGER':
      return 'The registry has confirmed this target as dangerous.'
    case 'STALE_CODEHASH_DRIFT':
      return 'The bytecode of this target differs from the code pinned at the last scan.'
  }
}

function bondReason(warrantyBond: bigint): string {
  if (warrantyBond <= 0n) return 'No warranty bond is recorded for this target.'
  return `The warranty bond of the publisher holds ${warrantyBond} wei.`
}

export type ContractReasonInput = {
  tier: TrustTier
  flags: FlagName[]
  isUpgradeableProxy: boolean
  implementationChanged: boolean | null
  warrantyBond: bigint
  safe: boolean
}

/** Every reason is one plain English sentence. */
export function contractReasons(input: ContractReasonInput): string[] {
  const reasons = [tierReason(input.tier)]
  if (input.isUpgradeableProxy) {
    reasons.push('The address is an upgradeable proxy, so its code can change without a new attestation.')
  }
  if (input.implementationChanged === true) {
    reasons.push('The code behind this proxy differs from the code it had at the last scan.')
  }
  if (input.isUpgradeableProxy && input.implementationChanged === null) {
    reasons.push('The address can change its own code, so the guard cannot prove that the code behind it is unchanged.')
  }
  for (const flag of input.flags) reasons.push(`The target carries the ${flag} flag.`)
  reasons.push(bondReason(input.warrantyBond))
  if (input.safe) reasons.push('The guard found nothing that makes this target unsafe.')
  return reasons
}

export type SkillReasonInput = {
  tier: TrustTier
  flags: FlagName[]
  warrantyBond: bigint
  publisher: Address | null
}

/** Every reason is one plain English sentence. */
export function skillReasons(input: SkillReasonInput): string[] {
  const reasons = [tierReason(input.tier)]
  reasons.push(
    input.publisher === null
      ? 'The registry has no verified publisher for this bundle.'
      : 'The registry has a verified publisher for this bundle.',
  )
  for (const flag of input.flags) reasons.push(`The bundle carries the ${flag} flag.`)
  reasons.push(bondReason(input.warrantyBond))
  return reasons
}
