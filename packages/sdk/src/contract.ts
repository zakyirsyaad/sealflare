import type { Address, Hex } from 'viem'
import { flagNames, targetIdOfContract, type FlagName, type TrustTier } from '@sealflare/shared/rules'
import { AddressSchema } from '@sealflare/shared/schemas'
import { inspectProxy } from '@sealflare/scanner-core'
import { readBondOf, readFirewall, readTarget, readTier, toRpcAdapter, type GuardDeps } from './chain'
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
 * The verdict of one contract.
 *
 * Every read either answers or throws. There is no path that turns a failed read into a safe
 * verdict, and a proxy is never safe whatever its tier says.
 */
export async function checkContract(deps: GuardDeps, address: Address): Promise<ContractVerdict> {
  const target = AddressSchema.parse(address)
  const targetId = targetIdOfContract(target)
  const tier = await readTier(deps.client, deps.core, targetId)
  const view = await readTarget(deps.client, deps.core, targetId)
  const firewall = await readFirewall(deps.client, deps.core, target)
  const proxy = await inspectProxy(target, await deps.client.getCode({ address: target }), toRpcAdapter(deps.client))
  const flags = flagNames(view.activeFlags)
  const isUpgradeableProxy = proxy !== null || firewall.isUpgradeableProxy
  const implementationChanged = changedImplementation(proxy, view.pinnedCodehash)
  const warrantyBond = await readBondOf(deps, targetId)
  const safe = isSafeTier(tier) && !isUpgradeableProxy && implementationChanged !== true
  const reasons = contractReasons({ tier, flags, isUpgradeableProxy, implementationChanged, warrantyBond, safe })
  return { tier, safe, isUpgradeableProxy, implementationChanged, flags, warrantyBond, reasons }
}

/**
 * True when the implementation holds different code than the code the registry pinned.
 *
 * Core pins the code hash of the target itself and cannot read the implementation slot, so the
 * guard compares the code of the implementation with the pinned hash. For a proxy the two differ,
 * which is the safe direction: a proxy is never safe whatever its tier says.
 */
function changedImplementation(proxy: { implementationCodehash: Hex } | null, pinnedCodehash: Hex): boolean | null {
  if (proxy === null) return null
  return proxy.implementationCodehash.toLowerCase() !== pinnedCodehash.toLowerCase()
}
