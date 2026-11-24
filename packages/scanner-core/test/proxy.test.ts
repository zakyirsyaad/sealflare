import { expect, test } from 'vitest'
import { type Address, type Hex } from 'viem'
import { type RpcAdapter } from '@sealflare/shared/schemas'
import { inspectProxy } from '../src/contract/proxy'

const address: Address = '0x1111111111111111111111111111111111111111'
const implementation: Address = '0x2222222222222222222222222222222222222222'
const beacon: Address = '0x3333333333333333333333333333333333333333'
const implementationSlot: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const beaconSlot: Hex = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
const word = (value: Address): Hex => `0x${'0'.repeat(24)}${value.slice(2)}`
const emptyHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
const clone: Hex = `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`

function rpcWith(storage: Partial<Record<Hex, Hex>> = {}): RpcAdapter {
  return {
    getStorageAt: async (to, slot) => {
      expect(to).toBe(address)
      if (slot !== implementationSlot && slot !== beaconSlot) throw Error('Unexpected storage slot')
      return storage[slot] ?? `0x${'0'.repeat(64)}`
    },
    getCode: async (to) => { expect(to).toBe(implementation); return '0x' },
    call: async () => { throw Error('Unexpected call') },
    getBlockNumber: async () => 1n,
  }
}

test('reads the low 20 bytes of the EIP-1967 implementation slot', async () => {
  const rpc = rpcWith({ [implementationSlot]: word(implementation) })
  expect(await inspectProxy(address, '0x6000', rpc)).toEqual({
    standard: 'eip1967', implementation, implementationCodehash: emptyHash,
  })
})

test('reads the beacon slot and calls implementation() on the beacon', async () => {
  const rpc = rpcWith({ [beaconSlot]: word(beacon) })
  rpc.call = async (tx) => {
    expect(tx).toEqual({ to: beacon, data: '0x5c60da1b' })
    return word(implementation)
  }
  expect(await inspectProxy(address, '0x6000', rpc)).toEqual({
    standard: 'beacon', implementation, implementationCodehash: emptyHash,
  })
})

test('recognises the exact EIP-1167 runtime and hashes the target bytecode', async () => {
  const rpc = rpcWith()
  rpc.getCode = async (to) => { expect(to).toBe(implementation); return '0x00' }
  expect(await inspectProxy(address, clone, rpc)).toEqual({
    standard: 'eip1167', implementation,
    implementationCodehash: '0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a',
  })
})

test('ordinary bytecode with empty storage is not a proxy', async () => {
  expect(await inspectProxy(address, '0x6001', rpcWith())).toBeNull()
})

test('a proxy target without code is still reported using keccak of empty bytes', async () => {
  expect(await inspectProxy(address, clone, rpcWith())).toMatchObject({ implementationCodehash: emptyHash })
})

test('an EIP-1167 pattern inside another runtime is not classified as a minimal proxy', async () => {
  expect(await inspectProxy(address, `0x00${clone.slice(2)}`, rpcWith())).toBeNull()
})

test.each(['storage', 'beacon', 'code'] as const)('%s RPC failure propagates', async (stage) => {
  const rpc = rpcWith({ [beaconSlot]: word(beacon) })
  const failure = Error('RPC unavailable')
  if (stage === 'storage') rpc.getStorageAt = async () => { throw failure }
  if (stage === 'beacon') rpc.call = async () => { throw failure }
  if (stage === 'code') {
    rpc.call = async () => word(implementation)
    rpc.getCode = async () => { throw failure }
  }
  await expect(inspectProxy(address, '0x6000', rpc)).rejects.toBe(failure)
})

test('malformed beacon responses fail instead of reading as not a proxy', async () => {
  const rpc = rpcWith({ [beaconSlot]: word(beacon) })
  rpc.call = async () => '0x1234'
  await expect(inspectProxy(address, '0x6000', rpc)).rejects.toThrow()
})
