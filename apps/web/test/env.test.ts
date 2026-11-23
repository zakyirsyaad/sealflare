import { expect, test, vi } from 'vitest'
import { parsePublicEnv, parseServerEnv } from '../lib/env.schema'
const server = { INTERNAL_URL: 'https://internal.example.com', INTERNAL_KEY: 'test-only-key', RPC_URLS: 'https://rpc.example.com,http://127.0.0.1:8545', BSCSCAN_KEY: 'test', GITHUB_TOKEN: 'test', PINATA_JWT: 'test', SCANNER: 'mock' }
test('every missing server variable fails naming the variable', () => {
  for (const name of Object.keys(server)) expect(() => parseServerEnv({ ...server, [name]: undefined })).toThrow(name)
})
test('parses only explicit public fields and exact boolean values', () => {
  expect(parsePublicEnv({ ...server, NEXT_PUBLIC_CHAIN_ID: '56', NEXT_PUBLIC_MODULES_LIVE: 'false' })).toEqual({ NEXT_PUBLIC_CHAIN_ID: 56, NEXT_PUBLIC_MODULES_LIVE: false })
  expect(parsePublicEnv({ NEXT_PUBLIC_MODULES_LIVE: 'true' }).NEXT_PUBLIC_MODULES_LIVE).toBe(true)
  for (const value of ['yes', '0', 'FALSE']) expect(() => parsePublicEnv({ NEXT_PUBLIC_MODULES_LIVE: value })).toThrow('NEXT_PUBLIC_MODULES_LIVE')
  expect(() => parsePublicEnv({ NEXT_PUBLIC_CHAIN_ID: 'oops' })).toThrow('NEXT_PUBLIC_CHAIN_ID')
})
test('server environment validates URLs and scanner mode without leaking values', () => {
  expect(parseServerEnv(server).RPC_URLS).toEqual(['https://rpc.example.com', 'http://127.0.0.1:8545'])
  for (const [key, value] of [['INTERNAL_URL', 'secret-invalid-url'], ['RPC_URLS', 'javascript:bad'], ['SCANNER', 'other']] as const) {
    expect(() => parseServerEnv({ ...server, [key]: value })).toThrow(key)
    expect(() => parseServerEnv({ ...server, [key]: value })).not.toThrow(value)
  }
  expect(Object.keys(parseServerEnv(server)).some(key => key.startsWith('NEXT_PUBLIC_'))).toBe(false)
})
test('env facade exposes validated public and server environments', async () => {
  for (const [name, value] of Object.entries(server)) vi.stubEnv(name, value)
  try {
    const { publicEnv, serverEnv } = await import('../lib/env')
    expect(serverEnv.SCANNER).toBe('mock')
    expect(publicEnv.NEXT_PUBLIC_MODULES_LIVE).toBe(false)
  } finally { vi.unstubAllEnvs() }
})
