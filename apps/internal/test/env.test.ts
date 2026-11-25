import { expect, test } from 'vitest'
import { parseEnv } from '../src/env'

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
