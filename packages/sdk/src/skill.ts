import type { Address, Hex } from 'viem'
import { bundleIdentity, flagNames, ZERO_ADDRESS, type BundleEntry, type FlagName, type TrustTier } from '@sealflare/shared/rules'
import { readSkillBundle, type GuardDeps } from './chain'
import { isSafeTier, skillReasons } from './reasons'

export type SkillVerdict = {
  tier: TrustTier
  safe: boolean
  canonicalBundleHash: Hex
  publisher: Address | null
  flags: FlagName[]
  warrantyBond: bigint
  reasons: string[]
}

/**
 * The verdict of one skill bundle.
 *
 * The canonical hash is computed here, from the entries, so a changed file changes the answer. The
 * bundle is never executed and its scripts are never run. The publisher is the one the registry
 * verified, not the one the bundle claims for itself.
 */
export async function checkSkill(deps: GuardDeps, entries: readonly BundleEntry[]): Promise<SkillVerdict> {
  const identity = bundleIdentity(entries)
  const bundle = await readSkillBundle(deps.client, deps.core, identity.canonicalBundleHash)
  const flags = flagNames(bundle.activeFlags)
  const publisher = bundle.publisher.toLowerCase() === ZERO_ADDRESS ? null : bundle.publisher
  const warrantyBond = bundle.warrantyBond
  const safe = isSafeTier(bundle.tier)
  const reasons = skillReasons({ tier: bundle.tier, flags, warrantyBond, publisher })
  return {
    tier: bundle.tier,
    safe,
    canonicalBundleHash: identity.canonicalBundleHash,
    publisher,
    flags,
    warrantyBond,
    reasons,
  }
}
