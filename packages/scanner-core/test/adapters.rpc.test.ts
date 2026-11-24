import { expect, test, vi } from 'vitest'
import { ExecutionRevertedError } from 'viem'
import { createRpcAdapter } from '../src/adapters/rpc'
import { ADDRESS, word } from './contract.fixtures'

const urls = ['https://first.invalid/private-key', 'https://second.invalid']
const response = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))

test('falls back to the second URL when the first fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    if (String(input).startsWith(urls[0]!)) throw Error('private-key')
    return response('0x6000')
  })
  expect(await createRpcAdapter(urls, { fetch: fetcher }).getCode(ADDRESS)).toBe('0x6000')
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://first.invalid/private-key', 'https://second.invalid/'])
})

test('throws a sanitized RPC_UNAVAILABLE when all URLs fail', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw Error('private-key') })
  const rpc = createRpcAdapter(urls, { fetch: fetcher })
  await expect(rpc.getCode(ADDRESS)).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' })
  await expect(rpc.getCode(ADDRESS)).rejects.not.toThrow('private-key')
})

test('a request exceeding its timeout falls back even if fetch ignores abort', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => String(url) === urls[0] ? new Promise(() => {}) : response('0x6000'))
  expect(await createRpcAdapter(urls, { fetch: fetcher, timeoutMs: 15 }).getCode(ADDRESS)).toBe('0x6000')
})

test('all four RPC methods serialize their request and validate the result', async () => {
  const requests: Record<string, unknown>[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body)
    return response(body.method === 'eth_blockNumber' ? '0x3197500' : word(0n))
  }
  const rpc = createRpcAdapter([urls[1]!], { fetch: fetcher })
  expect(await rpc.getStorageAt(ADDRESS, word(1n))).toBe(word(0n))
  expect(await rpc.call({ to: ADDRESS, from: ADDRESS, data: '0x1234', value: 5n })).toBe(word(0n))
  expect(await rpc.getBlockNumber()).toBe(52_000_000n)
  expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
    { method: 'eth_getStorageAt', params: [ADDRESS, word(1n), 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESS, from: ADDRESS, data: '0x1234', value: '0x5' }, 'latest'] },
    { method: 'eth_blockNumber', params: [] },
  ])
})

test('EVM reverts survive as typed errors for dryRun, without leaking credentials', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1,
    error: { code: 3, message: 'execution reverted private-key', data: '0x' } }))
  const rpc = createRpcAdapter(urls, { fetch: fetcher })
  await expect(rpc.call({ to: ADDRESS, data: '0x1234' })).rejects.toBeInstanceOf(ExecutionRevertedError)
  await expect(rpc.call({ to: ADDRESS, data: '0x1234' })).rejects.not.toThrow('private-key')
})

test('malformed successful responses try the next provider', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => response(String(url) === urls[0] ? 'not-hex' : '0x6000'))
  expect(await createRpcAdapter(urls, { fetch: fetcher }).getCode(ADDRESS)).toBe('0x6000')
})

test('invalid configuration and invalid addresses are rejected before network access', async () => {
  const fetcher = vi.fn<typeof fetch>()
  expect(() => createRpcAdapter([])).toThrow()
  expect(() => createRpcAdapter(['file:///etc/passwd'])).toThrow()
  await expect(createRpcAdapter(urls, { fetch: fetcher }).getCode('0x1234')).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
