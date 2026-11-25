import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { coreAbi, firewallAbi, vaultAbi } from '@sealflare/shared/abi'
import { TRUST_TIERS, type TrustTier } from '@sealflare/shared/rules'
import type { RpcAdapter } from '@sealflare/shared/schemas'

/** One read only contract call. The guard never writes and never signs anything. */
export type ContractCall = {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

/** The part of a viem PublicClient that the guard needs. */
export type GuardClient = {
  readContract(call: ContractCall): Promise<unknown>
  getCode(parameters: { address: Address }): Promise<Hex>
  getStorageAt(parameters: { address: Address; slot: Hex }): Promise<Hex>
  call(parameters: { to: Address; data: Hex }): Promise<{ data: Hex }>
  getBlockNumber(): Promise<bigint>
}

/** Where the guard reads from. The vault is optional, without it the bond is zero. */
export type GuardDeps = {
  client: GuardClient
  core: Address
  vault?: Address
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

/** The three fields of a target that the guard reads. Everything else on the target is ignored. */
const TargetView = z.object({
  pinnedCodehash: Bytes32,
  activeFlags: z.number().int().min(0).max(0xffffffff),
  attestationCount: z.number().int().min(0),
})

/** The view of a contract through IFirewall. */
const FirewallView = z.tuple([
  z.number().int().min(0).max(TRUST_TIERS.length - 1),
  z.boolean(),
  Bytes32,
  z.number().int().min(0).max(0xffffffff),
  z.bigint(),
])

/** The three fields of a vote that the guard reads. */
const AttestationView = z.object({
  verdict: z.number().int().min(0).max(2),
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
  const verdict = (['SAFE', 'CAUTION', 'DANGER'] as const)[view.verdict]
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

export async function readBond(client: GuardClient, vault: Address, targetId: Hex): Promise<bigint> {
  const raw = await client.readContract({ address: vault, abi: vaultAbi, functionName: 'activeBond', args: [targetId] })
  return z.bigint().parse(raw)
}

/** The bond of the publisher, or zero when no vault is configured. */
export async function readBondOf(deps: GuardDeps, targetId: Hex): Promise<bigint> {
  if (deps.vault === undefined || deps.vault.toLowerCase() === ZERO_ADDRESS) return 0n
  return readBond(deps.client, deps.vault, targetId)
}

/** The scanner reads over RPC. This is the same seam, filled from the injected client. */
export function toRpcAdapter(client: GuardClient): RpcAdapter {
  return {
    getCode: (address) => client.getCode({ address }),
    getStorageAt: (address, slot) => client.getStorageAt({ address, slot }),
    call: async (tx) => (await client.call({ to: tx.to, data: tx.data })).data,
    getBlockNumber: () => client.getBlockNumber(),
  }
}
