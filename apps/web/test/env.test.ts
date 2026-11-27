import { expect, test, vi } from 'vitest'
import { parsePinataEnv, parsePublicEnv, parseServerEnv } from '../lib/env.schema'
const server = { INTERNAL_URL: 'https://internal.example.com', INTERNAL_KEY: 'test-only-key', RPC_URLS: 'https://rpc.example.com,http://127.0.0.1:8545', BSCSCAN_KEY: 'test', GITHUB_TOKEN: 'test', PINATA_JWT: 'test', SCANNER: 'mock' }
test('every missing server variable fails naming the variable', () => {
  for (const name of Object.keys(server)) expect(() => parseServerEnv({ ...server, [name]: undefined })).toThrow(name)
})
test('parses only explicit public fields and exact boolean values', () => {
  expect(parsePublicEnv({ ...server, NEXT_PUBLIC_CHAIN_ID: '56', NEXT_PUBLIC_MODULES_LIVE: 'false' })).toEqual({ NEXT_PUBLIC_CHAIN_ID: 56, NEXT_PUBLIC_MODULES_LIVE: false, NEXT_PUBLIC_E2E: false })
  expect(parsePublicEnv({ NEXT_PUBLIC_MODULES_LIVE: 'true' }).NEXT_PUBLIC_MODULES_LIVE).toBe(true)
  for (const value of ['yes', '0', 'FALSE']) expect(() => parsePublicEnv({ NEXT_PUBLIC_MODULES_LIVE: value })).toThrow('NEXT_PUBLIC_MODULES_LIVE')
  expect(() => parsePublicEnv({ NEXT_PUBLIC_CHAIN_ID: 'oops' })).toThrow('NEXT_PUBLIC_CHAIN_ID')
})
test('the chain id must be one the app supports, so a typo fails at startup with the variable name', () => {
  for (const value of [56, 97, 31337]) expect(parsePublicEnv({ NEXT_PUBLIC_CHAIN_ID: String(value) }).NEXT_PUBLIC_CHAIN_ID).toBe(value)
  expect(parsePublicEnv({}).NEXT_PUBLIC_CHAIN_ID).toBe(56)
  for (const value of ['1', '0', '5600']) expect(() => parsePublicEnv({ NEXT_PUBLIC_CHAIN_ID: value })).toThrow('NEXT_PUBLIC_CHAIN_ID')
})
test('the Agent ID link is optional, must be an HTTP(S) URL, and an empty value counts as unset', () => {
  expect(parsePublicEnv({}).NEXT_PUBLIC_AGENT_ID_URL).toBeUndefined()
  expect(parsePublicEnv({ NEXT_PUBLIC_AGENT_ID_URL: '' }).NEXT_PUBLIC_AGENT_ID_URL).toBeUndefined()
  expect(parsePublicEnv({ NEXT_PUBLIC_AGENT_ID_URL: 'https://agent-id.example/get' }).NEXT_PUBLIC_AGENT_ID_URL).toBe('https://agent-id.example/get')
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'not a url']) {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_AGENT_ID_URL: value })).toThrow('NEXT_PUBLIC_AGENT_ID_URL')
  }
})
test('the end-to-end flag is off unless the build says so, so a deployment never offers the wallet of the suite', () => {
  expect(parsePublicEnv({}).NEXT_PUBLIC_E2E).toBe(false)
  expect(parsePublicEnv({ NEXT_PUBLIC_E2E: 'true' }).NEXT_PUBLIC_E2E).toBe(true)
  for (const value of ['yes', '1', 'TRUE']) expect(() => parsePublicEnv({ NEXT_PUBLIC_E2E: value })).toThrow('NEXT_PUBLIC_E2E')
})
test('the storage of the evidence is the API of Pinata unless a deployment names another one', () => {
  expect(parsePinataEnv({ PINATA_JWT: 'test' }).PINATA_URL).toBe('https://api.pinata.cloud/pinning/pinFileToIPFS')
  expect(parsePinataEnv({ PINATA_JWT: 'test', PINATA_URL: 'http://127.0.0.1:1234/pinning/pinFileToIPFS' }).PINATA_URL).toBe('http://127.0.0.1:1234/pinning/pinFileToIPFS')
  expect(() => parsePinataEnv({ PINATA_JWT: 'test', PINATA_URL: 'javascript:bad' })).toThrow('PINATA_URL')
  expect(() => parsePinataEnv({})).toThrow('PINATA_JWT')
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
