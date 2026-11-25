import type { Address, Hex } from 'viem'
import { bundleIdentity, flagNames, ZERO_ADDRESS, type BundleEntry, type FlagName, type TrustTier } from '@sealflare/shared/rules'
import { readBondOf, readTarget, readTier, type GuardDeps } from './chain'
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
 * bundle is never executed and its scripts are never run.
 */
export async function checkSkill(deps: GuardDeps, entries: readonly BundleEntry[]): Promise<SkillVerdict> {
  const identity = bundleIdentity(entries)
  const tier = await readTier(deps.client, deps.core, identity.targetId)
  const view = await readTarget(deps.client, deps.core, identity.targetId)
  const flags = flagNames(view.activeFlags)
  const warrantyBond = await readBondOf(deps, identity.targetId)
  const publisher = identity.manifestPublisher.toLowerCase() === ZERO_ADDRESS ? null : identity.manifestPublisher
  const safe = isSafeTier(tier)
  const reasons = skillReasons({ tier, flags, warrantyBond, publisher })
  return { tier, safe, canonicalBundleHash: identity.canonicalBundleHash, publisher, flags, warrantyBond, reasons }
}
