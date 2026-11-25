import type { Address, Hex, PublicClient } from 'viem'
import type { BundleEntry } from '@sealflare/shared/rules'
import { readAttestations, readTarget, type GuardClient } from './chain'
import { checkContract, type ContractVerdict } from './contract'
import { checkSkill, type SkillVerdict } from './skill'
import { splitSignal, type SignalSummary } from './signal'

export type GuardOptions = {
  /** A viem public client. The guard only reads, it never signs or sends a transaction. */
  client: PublicClient
  /** The Sealflare Core contract, which also implements IFirewall. */
  core: Address
  /** The Sealflare Vault contract. Without it the warranty bond is zero. */
  vault?: Address
}

export type Guard = {
  /** The verdict of one contract on BNB Chain. */
  checkContract(address: Address): Promise<ContractVerdict>
  /** The verdict of one skill bundle, from its files alone. */
  checkSkill(entries: readonly BundleEntry[]): Promise<SkillVerdict>
  /** The community signal of a target, with the new Agent IDs and the Guardians apart. */
  signal(targetId: Hex): Promise<SignalSummary>
}

/**
 * A guard reads the registry and the chain, and answers one question: is this safe?
 *
 * Every read either answers or throws. There is no path that turns a failed read into a safe
 * verdict, and a proxy is never safe whatever its tier says.
 */
export function createGuard(options: GuardOptions): Guard {
  const deps = {
    client: options.client as unknown as GuardClient,
    core: options.core,
    vault: options.vault,
  }
  return {
    checkContract: (address: Address) => checkContract(deps, address),
    checkSkill: (entries: readonly BundleEntry[]) => checkSkill(deps, entries),
    signal: async (targetId: Hex) => {
      const target = await readTarget(deps.client, deps.core, targetId)
      const attestations = await readAttestations(deps.client, deps.core, targetId, target.attestationCount)
      return splitSignal(attestations)
    },
  }
}

export type { ContractVerdict } from './contract'
export type { SkillVerdict } from './skill'
export type { SignalSummary } from './signal'
export type { BundleEntry, FlagName, TrustTier } from '@sealflare/shared/rules'
