import { beforeEach, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const wagmi = vi.hoisted(() => ({
  connection: {} as Record<string, unknown>,
  reads: {} as Record<string, { data?: unknown; isLoading: boolean; refetch: ReturnType<typeof vi.fn> }>,
  calls: [] as { functionName: string; enabled: boolean | undefined; address: unknown; args: unknown; chainId: unknown }[],
}))
vi.mock('wagmi', () => ({
  useConnection: () => wagmi.connection,
  useReadContract: (params: { functionName: string; address: unknown; args: unknown; chainId?: unknown; query?: { enabled?: boolean } }) => {
    wagmi.calls.push({ functionName: params.functionName, enabled: params.query?.enabled, address: params.address, args: params.args, chainId: params.chainId })
    return wagmi.reads[params.functionName]
  },
}))
vi.mock('../lib/chain/config', () => ({ expectedChainId: 56 }))
const addressFile = vi.hoisted(() => ({ missing: false }))
vi.mock('../lib/chain/addresses', () => ({
  addresses: () => {
    if (addressFile.missing) throw new Error('No contract addresses for chain 56. Add shared/abi/addresses.bsc.json after the Core release and rebuild.')
    return { core: '0x5FbDB2315678afecb367f032d93F642f64180aa3' }
  },
  coreAddressOrError: () => {
    if (addressFile.missing) {
      return {
        core: null,
        error: 'No contract addresses for chain 56. Add shared/abi/addresses.bsc.json after the Core release and rebuild.',
      }
    }
    return { core: '0x5FbDB2315678afecb367f032d93F642f64180aa3', error: null }
  },
}))

import { resolveUserState, useUserState } from '../lib/chain/userState'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const

beforeEach(() => {
  addressFile.missing = false
  wagmi.calls.length = 0
  wagmi.connection = { isConnected: true, address: me, chainId: 56 }
  wagmi.reads = {
    isAgentIdHolder: { data: true, isLoading: false, refetch: vi.fn() },
    attestationsLeftToday: { data: 3, isLoading: false, refetch: vi.fn() },
  }
})

test.each([
  ['no wallet', { isConnected: false }, 'no-wallet'],
  ['chain 1', { isConnected: true, address: me, chainId: 1 }, 'wrong-network'],
  ['no Agent ID', { isConnected: true, address: me, chainId: 56, isHolder: false }, 'no-agent-id'],
  ['holder', { isConnected: true, address: me, chainId: 56, isHolder: true, attestationsLeft: 3 }, 'holder'],
])('%s resolves to %s', (_name, input, kind) => {
  expect(resolveUserState({ expectedChainId: 56, ...input }).kind).toBe(kind)
})

test('a holder carries the address and the attestations left today', () => {
  expect(resolveUserState({ expectedChainId: 56, isConnected: true, address: me, chainId: 56, isHolder: true, attestationsLeft: 3 }))
    .toEqual({ kind: 'holder', address: me, attestationsLeft: 3 })
})

test('a wrong network wins over a missing Agent ID, because the read would be on the wrong chain', () => {
  expect(resolveUserState({ expectedChainId: 56, isConnected: true, address: me, chainId: 97, isHolder: false }).kind).toBe('wrong-network')
})

test('an unknown quota stays null, never 0 and never a full quota', () => {
  const state = resolveUserState({ expectedChainId: 56, isConnected: true, address: me, chainId: 56, isHolder: true })
  expect(state).toMatchObject({ kind: 'holder', attestationsLeft: null })
})

test('a failed quota read is reported and the quota stays unknown', () => {
  wagmi.reads.attestationsLeftToday = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'holder', attestationsLeft: null, isError: true })
})

test('while the wallet is reconnecting after a reload the hook says it is loading', () => {
  wagmi.connection = { isConnected: false, isReconnecting: true }
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'no-wallet', isLoading: true })
})

test('reads are pinned to the expected chain', () => {
  renderHook(() => useUserState())
  expect(wagmi.calls.every(call => call.chainId === 56)).toBe(true)
})

test('the hook reads Core directly for the connected address, not an indexer', () => {
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'holder', address: me, attestationsLeft: 3, isLoading: false })
  expect(wagmi.calls.map(call => call.functionName).sort()).toEqual(['attestationsLeftToday', 'isAgentIdHolder'])
  for (const call of wagmi.calls) {
    expect(call.address).toBe('0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(call.args).toEqual([me])
    expect(call.enabled).toBe(true)
  }
})

test('the hook does not read the chain without a wallet or on the wrong network', () => {
  wagmi.connection = { isConnected: false }
  renderHook(() => useUserState())
  expect(wagmi.calls.every(call => call.enabled === false)).toBe(true)
  wagmi.calls.length = 0
  wagmi.connection = { isConnected: true, address: me, chainId: 1 }
  renderHook(() => useUserState())
  expect(wagmi.calls.every(call => call.enabled === false)).toBe(true)
})

test('while the holder check is loading the hook says so and never claims the wallet has no Agent ID', () => {
  wagmi.reads.isAgentIdHolder = { data: undefined, isLoading: true, refetch: vi.fn() }
  const { result } = renderHook(() => useUserState())
  expect(result.current.isLoading).toBe(true)
  expect(result.current.kind).toBe('checking')
})

test('a failed holder read stays unknown and is reported, instead of being shown as no Agent ID', () => {
  wagmi.reads.isAgentIdHolder = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'checking', isLoading: false, isError: true })
})

test('a missing address file does not crash the hook: the state stays unknown and the cause is reported', () => {
  addressFile.missing = true
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'checking', address: me, isError: true })
  expect(result.current.error).toMatch(/addresses\.bsc\.json/)
  expect(wagmi.calls.every(call => call.enabled === false)).toBe(true)
})

test('a missing address file does not affect a visitor without a wallet', () => {
  addressFile.missing = true
  wagmi.connection = { isConnected: false }
  const { result } = renderHook(() => useUserState())
  expect(result.current).toMatchObject({ kind: 'no-wallet', isError: false })
})

test('no error is reported while everything works', () => {
  const { result } = renderHook(() => useUserState())
  expect(result.current.isError).toBe(false)
  expect(result.current.error).toBeUndefined()
})

test('an unknown holder answer resolves to checking', () => {
  expect(resolveUserState({ expectedChainId: 56, isConnected: true, address: me, chainId: 56 })).toEqual({ kind: 'checking', address: me })
})

test('recheck re-reads both views without reloading', () => {
  const { result } = renderHook(() => useUserState())
  result.current.recheck()
  expect(wagmi.reads.isAgentIdHolder!.refetch).toHaveBeenCalledTimes(1)
  expect(wagmi.reads.attestationsLeftToday!.refetch).toHaveBeenCalledTimes(1)
})
