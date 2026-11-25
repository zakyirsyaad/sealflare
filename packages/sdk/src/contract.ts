import type { Address, Hex } from 'viem'
import { flagNames, targetIdOfContract, type FlagName, type TrustTier } from '@sealflare/shared/rules'
import { AddressSchema, Bytes32Schema } from '@sealflare/shared/schemas'
import { hasDelegatecall, inspectProxy, type ProxyInfo } from '@sealflare/scanner-core'
import { readFirewall, readTarget, readTier, toRpcAdapter, type GuardDeps } from './chain'
import { contractReasons, isSafeTier } from './reasons'

export type ContractVerdict = {
  tier: TrustTier
  safe: boolean
  isUpgradeableProxy: boolean
  implementationChanged: boolean | null
  flags: FlagName[]
  warrantyBond: bigint
  reasons: string[]
}

/**
 * The implementation of the last scan, the only honest baseline for the code behind a proxy.
 *
 * `Core` pins the code hash of the target itself, never of its implementation, so the pinned hash
 * says nothing about the implementation.
 */
export type ImplementationBaseline = {
  /** The implementation address the last scan found. */
  address: Address
  /** The code hash that implementation held at the last scan. */
  codehash: Hex
}

/**
 * The verdict of one contract.
 *
 * Every read either answers or throws. There is no path that turns a failed read into a safe
 * verdict, and a proxy is never safe whatever its tier says.
 */
export async function checkContract(
  deps: GuardDeps,
  address: Address,
  baseline?: ImplementationBaseline,
): Promise<ContractVerdict> {
  const target = AddressSchema.parse(address)
  // The baseline is checked at the boundary, before any read, so a malformed one is never silently
  // ignored by an early return.
  const known = baseline === undefined ? undefined : parseBaseline(baseline)
  const targetId = targetIdOfContract(target)
  const tier = await readTier(deps.client, deps.core, targetId)
  const view = await readTarget(deps.client, deps.core, targetId)
  const firewall = await readFirewall(deps.client, deps.core, target)
  const code = (await deps.client.getCode({ address: target })) ?? '0x'
  const proxy = await inspectProxy(target, code, toRpcAdapter(deps.client))
  const flags = flagNames(view.activeFlags)
  // The registry marker only lights up when someone probed the bytecode, and the standard proxy
  // slots only cover the standard proxies. The bytecode itself is the objective marker.
  const isUpgradeableProxy = proxy !== null || firewall.isUpgradeableProxy || hasDelegatecall(code)
  const implementationChanged = changedImplementation(proxy, known)
  const warrantyBond = firewall.warrantyBond
  const safe = isSafeTier(tier) && !isUpgradeableProxy && implementationChanged !== true
  const reasons = contractReasons({ tier, flags, isUpgradeableProxy, implementationChanged, warrantyBond, safe })
  return { tier, safe, isUpgradeableProxy, implementationChanged, flags, warrantyBond, reasons }
}

/**
 * Whether the code behind the proxy moved since the baseline of the last scan.
 *
 * Without a baseline the answer is unknown, never a change. The pinned hash of the registry is the
 * hash of the target itself, so it never says anything about the implementation.
 */
function changedImplementation(proxy: ProxyInfo, baseline?: ImplementationBaseline): boolean | null {
  if (proxy === null) return null
  if (baseline === undefined) return null
  if (baseline.address.toLowerCase() !== proxy.implementation.toLowerCase()) return true
  return proxy.implementationCodehash.toLowerCase() !== baseline.codehash.toLowerCase()
}

/** The baseline is validated with the shared schemas, at the boundary of the call. */
function parseBaseline(baseline: ImplementationBaseline): ImplementationBaseline {
  return { address: AddressSchema.parse(baseline.address), codehash: Bytes32Schema.parse(baseline.codehash) }
}
