import type { Address, Hex, PublicClient } from 'viem'
import type { BundleEntry } from '@sealflare/shared/rules'
import { AddressSchema, Bytes32Schema } from '@sealflare/shared/schemas'
import { readAttestations, readTarget } from './chain'
import { checkContract, type ContractVerdict, type ImplementationBaseline } from './contract'
import { checkSkill, type SkillVerdict } from './skill'
import { splitSignal, type SignalSummary } from './signal'

export type GuardOptions = {
  /** A viem public client. The guard only reads, it never signs or sends a transaction. */
  client: PublicClient
  /** The Sealflare Core contract, which also implements IFirewall. */
  core: Address
}

export type Guard = {
  /** The verdict of one contract on BNB Chain. */
  checkContract(address: Address, baseline?: ImplementationBaseline): Promise<ContractVerdict>
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
    client: options.client,
    core: AddressSchema.parse(options.core),
  }
  return {
    checkContract: (address: Address, baseline?: ImplementationBaseline) => checkContract(deps, address, baseline),
    checkSkill: (entries: readonly BundleEntry[]) => checkSkill(deps, entries),
    signal: async (targetId: Hex) => {
      const id = Bytes32Schema.parse(targetId)
      const target = await readTarget(deps.client, deps.core, id)
      const attestations = await readAttestations(deps.client, deps.core, id, target.attestationCount)
      return splitSignal(attestations)
    },
  }
}

export type { ContractVerdict, ImplementationBaseline } from './contract'
export type { SkillVerdict } from './skill'
export type { SignalSummary } from './signal'
export type { BundleEntry, FlagName, TrustTier } from '@sealflare/shared/rules'
