import { keccak256, type Address, type Hex } from 'viem'
import { AddressSchema, Bytes32Schema, type RpcAdapter } from '@sealflare/shared/schemas'
import { Bytecode } from './bytecode'

export const EIP1967_IMPLEMENTATION_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export const EIP1967_BEACON_SLOT: Hex = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'

export type ProxyInfo = {
  standard: 'eip1967' | 'beacon' | 'eip1167'
  implementation: Address
  implementationCodehash: Hex
} | null

const MINIMAL_PROXY = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function addressInWord(word: Hex): Address {
  return AddressSchema.parse(`0x${Bytes32Schema.parse(word).slice(-40)}`)
}

async function describe(standard: NonNullable<ProxyInfo>['standard'], implementation: Address, rpc: RpcAdapter) {
  const code = Bytecode.parse(await rpc.getCode(implementation))
  return { standard, implementation, implementationCodehash: keccak256(code) }
}

/** RPC failures and malformed responses propagate so callers cannot mistake them for a negative. */
export async function inspectProxy(address: Address, code: Hex, rpc: RpcAdapter): Promise<ProxyInfo> {
  const target = AddressSchema.parse(address)
  const clone = MINIMAL_PROXY.exec(Bytecode.parse(code))
  if (clone) return describe('eip1167', AddressSchema.parse(`0x${clone[1]}`), rpc)

  const implementation = addressInWord(await rpc.getStorageAt(target, EIP1967_IMPLEMENTATION_SLOT))
  if (implementation !== ZERO_ADDRESS) return describe('eip1967', implementation, rpc)

  const beacon = addressInWord(await rpc.getStorageAt(target, EIP1967_BEACON_SLOT))
  if (beacon === ZERO_ADDRESS) return null
  const beaconImplementation = addressInWord(await rpc.call({ to: beacon, data: '0x5c60da1b' }))
  if (beaconImplementation === ZERO_ADDRESS) throw new Error('Beacon returned a zero implementation address.')
  return describe('beacon', beaconImplementation, rpc)
}
