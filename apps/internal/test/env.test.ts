import { expect, test } from 'vitest'
import { parseEnv, sandboxConfig } from '../src/env'

/** A key that looks like the random one the founder generates. */
const SAMPLE = '0123456789abcdef0123456789abcdef'

const VALID = {
  DATABASE_URL: 'postgres://sealflare:secret@127.0.0.1:5432/sealflare',
  INTERNAL_KEY: SAMPLE,
}

test('the environment parses and the port has a default', () => {
  const env = parseEnv(VALID)
  expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL)
  expect(env.PORT).toBe(3040)
})

test('the port comes from the environment when it is set', () => {
  expect(parseEnv({ ...VALID, PORT: '8080' }).PORT).toBe(8080)
})

test('a missing variable is named in the message', () => {
  expect(() => parseEnv({ INTERNAL_KEY: SAMPLE })).toThrow(/DATABASE_URL/)
  expect(() => parseEnv({ DATABASE_URL: VALID.DATABASE_URL })).toThrow(/INTERNAL_KEY/)
})

test('a key that is too short is refused', () => {
  expect(() => parseEnv({ ...VALID, INTERNAL_KEY: 'too-short' })).toThrow(/INTERNAL_KEY/)
})

test('a key without enough different characters is refused', () => {
  expect(() => parseEnv({ ...VALID, INTERNAL_KEY: 'a'.repeat(32) })).toThrow(/INTERNAL_KEY/)
})

test('a port that is not a number is refused', () => {
  expect(() => parseEnv({ ...VALID, PORT: 'not a port' })).toThrow(/PORT/)
})

/** Every variable the sandbox needs, so a test can take one away. */
const SANDBOX = {
  CHAIN_ID: 56,
  CORE_ADDRESS: `0x${'11'.repeat(20)}`,
  RPC_URLS: 'https://rpc.example',
  WORKER_URL: 'https://worker.example',
  WORKER_BEARER_KEY: SAMPLE,
  SANDBOX_PROBE_SET_VERSION: 'v1-5b7afb275dd1bf5827eb568bb11b729f',
  SANDBOX_MODEL_ID: 'sealflare-sim-v1',
}

test('the sandbox is only started when every variable is there', () => {
  expect(sandboxConfig(SANDBOX)?.probeSetVersion).toBe(SANDBOX.SANDBOX_PROBE_SET_VERSION)
  expect(sandboxConfig({ ...SANDBOX, SANDBOX_PROBE_SET_VERSION: undefined })).toBeNull()
  expect(sandboxConfig({ ...SANDBOX, SANDBOX_MODEL_ID: undefined })).toBeNull()
  expect(sandboxConfig({ ...SANDBOX, WORKER_URL: undefined })).toBeNull()
})

test('the probe set version and the model have no default', () => {
  const env = parseEnv(VALID)
  expect(env.SANDBOX_PROBE_SET_VERSION).toBeUndefined()
  expect(env.SANDBOX_MODEL_ID).toBeUndefined()
})
