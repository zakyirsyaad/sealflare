import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { coreAbi, firewallAbi } from '@sealflare/shared/abi'
import { TRUST_TIERS, VERDICTS, type TrustTier } from '@sealflare/shared/rules'
import { AddressSchema, Bytes32Schema, type RpcAdapter } from '@sealflare/shared/schemas'

/** One read only contract call. The guard never writes and never signs anything. */
export type ContractCall = {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

/**
 * The part of a viem PublicClient that the guard needs.
 *
 * An account without code has no bytecode, and viem answers `undefined` for it. The guard reads
 * that as empty code, never as a failure and never as code it did not see.
 */
export type GuardClient = {
  readContract(call: ContractCall): Promise<unknown>
  getCode(parameters: { address: Address }): Promise<Hex | undefined>
  getStorageAt(parameters: { address: Address; slot: Hex }): Promise<Hex | undefined>
  call(parameters: { to: Address; data: Hex }): Promise<{ data: Hex | undefined }>
  getBlockNumber(): Promise<bigint>
}

/** Where the guard reads from. Every value comes from the Core contract, which is the firewall. */
export type GuardDeps = {
  client: GuardClient
  core: Address
}

/** The three fields of a target that the guard reads. Everything else on the target is ignored. */
const TargetView = z.object({
  pinnedCodehash: Bytes32Schema,
  activeFlags: z.number().int().min(0).max(0xffffffff),
  attestationCount: z.number().int().min(0),
})

/** The view of a contract through IFirewall. */
const FirewallView = z.tuple([
  z.number().int().min(0).max(TRUST_TIERS.length - 1),
  z.boolean(),
  Bytes32Schema,
  z.number().int().min(0).max(0xffffffff),
  z.bigint(),
])

/** The view of a skill bundle through IFirewall. */
const SkillBundleView = z.tuple([
  z.number().int().min(0).max(TRUST_TIERS.length - 1),
  AddressSchema,
  z.number().int().min(0).max(0xffffffff),
  z.bigint(),
])

/** The three fields of a vote that the guard reads. */
const AttestationView = z.object({
  verdict: z.number().int().min(0).max(VERDICTS.length - 1),
  flags: z.number().int().min(0).max(0xffffffff),
  weight: z.number().int().min(0).max(5),
})

export type OnChainTarget = { pinnedCodehash: Hex; activeFlags: number; attestationCount: number }

export type OnChainAttestation = { verdict: 'SAFE' | 'CAUTION' | 'DANGER'; flags: number; weight: number }

export type OnChainFirewall = {
  tier: TrustTier
  isUpgradeableProxy: boolean
  pinnedCodehash: Hex
  activeFlags: number
  warrantyBond: bigint
}

export type OnChainSkillBundle = {
  tier: TrustTier
  publisher: Address
  activeFlags: number
  warrantyBond: bigint
}

/** The tier enum of the registry and the tier names of the shared rules are the same order. */
export function tierName(value: unknown): TrustTier {
  const index = z.number().int().min(0).max(TRUST_TIERS.length - 1).parse(value)
  const tier = TRUST_TIERS[index]
  if (!tier) throw new Error('The registry returned a tier that does not exist.')
  return tier
}

export async function readTier(client: GuardClient, core: Address, targetId: Hex): Promise<TrustTier> {
  const raw = await client.readContract({ address: core, abi: coreAbi, functionName: 'tierOf', args: [targetId] })
  return tierName(raw)
}

export async function readTarget(client: GuardClient, core: Address, targetId: Hex): Promise<OnChainTarget> {
  const raw = await client.readContract({ address: core, abi: coreAbi, functionName: 'getTarget', args: [targetId] })
  const view = TargetView.parse(raw)
  return {
    pinnedCodehash: view.pinnedCodehash as Hex,
    activeFlags: view.activeFlags,
    attestationCount: view.attestationCount,
  }
}

/** One vote of the registry. Only the verdict, the flags and the frozen weight are read. */
export async function readAttestation(
  client: GuardClient,
  core: Address,
  targetId: Hex,
  index: number,
): Promise<OnChainAttestation> {
  const raw = await client.readContract({ address: core, abi: coreAbi, functionName: 'getAttestation', args: [targetId, index] })
  const view = AttestationView.parse(raw)
  const verdict = VERDICTS[view.verdict]
  if (!verdict) throw new Error('The registry returned a verdict that does not exist.')
  return { verdict, flags: view.flags, weight: view.weight }
}

const READ_BATCH = 10

/** Every vote of a target, in batches, so a big target does not open too many calls at once. */
export async function readAttestations(
  client: GuardClient,
  core: Address,
  targetId: Hex,
  count: number,
): Promise<OnChainAttestation[]> {
  const rows: OnChainAttestation[] = []
  for (let start = 0; start < count; start += READ_BATCH) {
    const indexes = Array.from({ length: Math.min(READ_BATCH, count - start) }, (_, offset) => start + offset)
    rows.push(...(await Promise.all(indexes.map(index => readAttestation(client, core, targetId, index)))))
  }
  return rows
}

export async function readFirewall(client: GuardClient, core: Address, address: Address): Promise<OnChainFirewall> {
  const raw = await client.readContract({ address: core, abi: firewallAbi, functionName: 'verifyContract', args: [address] })
  const view = FirewallView.parse(raw)
  return {
    tier: tierName(view[0]),
    isUpgradeableProxy: view[1],
    pinnedCodehash: view[2] as Hex,
    activeFlags: view[3],
    warrantyBond: view[4],
  }
}

/**
 * The bundle through the firewall.
 *
 * The publisher is the verified one. The zero address means the bundle has no verified publisher,
 * or only a third party sponsor.
 */
export async function readSkillBundle(
  client: GuardClient,
  core: Address,
  canonicalBundleHash: Hex,
): Promise<OnChainSkillBundle> {
  const raw = await client.readContract({
    address: core,
    abi: firewallAbi,
    functionName: 'verifySkillBundle',
    args: [canonicalBundleHash],
  })
  const view = SkillBundleView.parse(raw)
  return {
    tier: tierName(view[0]),
    publisher: view[1],
    activeFlags: view[2],
    warrantyBond: view[3],
  }
}

/** The scanner reads over RPC. This is the same seam, filled from the injected client. */
export function toRpcAdapter(client: GuardClient): RpcAdapter {
  return {
    // Only the code and the call of an address without code answer empty. A storage slot that
    // answers nothing is a node that did not answer the question, and that is not an empty slot.
    getCode: async (address) => (await client.getCode({ address })) ?? '0x',
    getStorageAt: async (address, slot) => {
      const value = await client.getStorageAt({ address, slot })
      if (value === undefined || value === null) {
        throw new Error(`The node returned no storage for ${address} at ${slot}.`)
      }
      return value
    },
    call: async (tx) => (await client.call({ to: tx.to, data: tx.data })).data ?? '0x',
    getBlockNumber: () => client.getBlockNumber(),
  }
}
