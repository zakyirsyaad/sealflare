import { type Address, type Hex } from 'viem'
import { type ExplorerAdapter, type RpcAdapter } from '@sealflare/shared/schemas'

export const ADDRESS: Address = '0x1111111111111111111111111111111111111111'
export const IMPLEMENTATION: Address = '0x2222222222222222222222222222222222222222'
export const IMPLEMENTATION_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export const BEACON_SLOT: Hex = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
export const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`
export const clone: Hex = `0x363d3d373d3d3d363d73${IMPLEMENTATION.slice(2)}5af43d82803e903d91602b57fd5bf3`
export const transferData: Hex = `0xa9059cbb${'0'.repeat(24)}${ADDRESS.slice(2)}${'0'.repeat(64)}`
export const abiWith = (...names: string[]) => names.map((name) => ({
  type: 'function', name, inputs: [], outputs: [], stateMutability: 'nonpayable',
}))

export const explorerWith = (abi: unknown = []): ExplorerAdapter => ({
  getSource: async () => ({ verified: true, files: [{ path: 'Token.sol', content: 'contract Token {}' }], abi }),
})

export function cleanRpc(): RpcAdapter {
  return {
    getCode: async () => '0x6000',
    getStorageAt: async () => word(0n),
    getBlockNumber: async () => 52_000_000n,
    call: async (tx) => {
      if (tx.to !== ADDRESS) throw Error('Unexpected destination')
      if (tx.data === '0x313ce567') return word(18n)
      if (tx.data === '0x18160ddd') return word(1_000_000n)
      if (tx.data === transferData && tx.from === ADDRESS) return word(1n)
      throw Error('Unexpected call')
    },
  }
}
