import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: true,
}))

import {
  canKeepRevealCode,
  commitHashFor,
  loadRevealCode,
  loadRevealCodes,
  newRevealCode,
  parseRevealCode,
  saveRevealCode,
} from '../lib/revealCode'

const JUROR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address
const OTHER = '0x5200000000000000000000000000000000000c19' as Address
const SALT = `0x${'11'.repeat(32)}` as Hex
const HEX64 = 'a'.repeat(64)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('a new code round-trips through parseRevealCode', () => {
  for (const uphold of [true, false]) {
    const code = newRevealCode(12n, uphold)
    expect(code).toMatch(/^sf1\.12\.[ur]\.[0-9a-f]{64}$/)
    const parsed = parseRevealCode(code)
    expect(parsed).not.toBeNull()
    expect(parsed?.challengeId).toBe(12n)
    expect(parsed?.uphold).toBe(uphold)
    expect(parsed?.salt).toBe(`0x${code.slice(-64)}`)
  }
})

test('a code names the direction: u for uphold, r for reject', () => {
  expect(newRevealCode(1n, true).split('.')[2]).toBe('u')
  expect(newRevealCode(1n, false).split('.')[2]).toBe('r')
})

test('two codes for the same vote differ: the salt is random, never derived from a signature', () => {
  const codes = new Set(Array.from({ length: 100 }, () => newRevealCode(12n, true)))
  expect(codes.size).toBe(100)
  const salts = new Set([...codes].map(code => code.slice(-64)))
  expect(salts.size).toBe(100)
})

test('the salt is 32 bytes from crypto.getRandomValues', () => {
  const spy = vi.spyOn(crypto, 'getRandomValues')
  const code = newRevealCode(3n, false)
  expect(spy).toHaveBeenCalledTimes(1)
  const buffer = spy.mock.calls[0]?.[0] as Uint8Array
  expect(buffer).toBeInstanceOf(Uint8Array)
  expect(buffer.length).toBe(32)
  expect(code.slice(-64)).toBe(Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join(''))
})

test('a salt of all zeroes is never handed out', () => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array !== null) (array as unknown as Uint8Array).fill(0)
    return array
  })
  expect(() => newRevealCode(1n, true)).toThrow()
})

test('commitHashFor equals keccak256(abi.encode(id, juror, uphold, salt))', () => {
  const code = `sf1.7.u.${SALT.slice(2)}`
  const expected = keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'bool' }, { type: 'bytes32' }],
      [7n, JUROR, true, SALT],
    ),
  )
  expect(commitHashFor(code, JUROR)).toBe(expected)
})

test.each([
  ['sf1.7.u.' + '11'.repeat(32), 'b73048115af4900df102b0d47199726f3ae3eca357ddd695bf5cf49495c61d38'],
  ['sf1.7.r.' + '11'.repeat(32), 'd906a521073aa7b08c6ffd672c779932f464d0f02fa0237f11282e1fbfc67420'],
])('commitHashFor(%s) matches the hash that cast and Court.commitHashOf give', (code, hash) => {
  expect(commitHashFor(code, JUROR)).toBe(`0x${hash}`)
})

test('the hash depends on the juror, the challenge and the direction', () => {
  const base = `sf1.7.u.${HEX64}`
  const hash = commitHashFor(base, JUROR)
  expect(commitHashFor(base, OTHER)).not.toBe(hash)
  expect(commitHashFor(`sf1.8.u.${HEX64}`, JUROR)).not.toBe(hash)
  expect(commitHashFor(`sf1.7.r.${HEX64}`, JUROR)).not.toBe(hash)
})

test('commitHashFor refuses a code that is not one', () => {
  expect(() => commitHashFor('not a code', JUROR)).toThrow(RangeError)
})

test.each([
  [''],
  ['sf1.1.u'],
  ['sf1.x.u.' + 'a'.repeat(64)],
  ['sf1.1.z.' + 'a'.repeat(64)],
  ['sf2.1.u.' + 'a'.repeat(64)],
  ['sf1.1.u.' + 'g'.repeat(64)],
  ['sf1.1.u.' + 'a'.repeat(63)],
  ['sf1.1.u.' + 'a'.repeat(65)],
  ['sf1.01.u.' + 'a'.repeat(64)],
  ['sf1.-1.u.' + 'a'.repeat(64)],
  ['sf1.1.u.0x' + 'a'.repeat(62)],
  ['sf1.1.u.' + 'a'.repeat(64) + '.extra'],
  ['sf1..u.' + 'a'.repeat(64)],
  [`sf1.${2n ** 256n}.u.` + 'a'.repeat(64)],
])('parseRevealCode(%s) is null', code => {
  expect(parseRevealCode(code)).toBeNull()
})

test('a code that was pasted with spaces around it is still read, and its salt is lower case', () => {
  const parsed = parseRevealCode(`  sf1.5.r.${'AB'.repeat(32)}\n`)
  expect(parsed).toEqual({ challengeId: 5n, uphold: false, salt: `0x${'ab'.repeat(32)}` })
})

test('the largest challenge id of the contract is read, and zero is a number too', () => {
  expect(parseRevealCode(`sf1.${2n ** 256n - 1n}.u.${HEX64}`)?.challengeId).toBe(2n ** 256n - 1n)
  expect(parseRevealCode(`sf1.0.u.${HEX64}`)?.challengeId).toBe(0n)
})

test('a saved code is loaded for the same challenge and the same juror', () => {
  const code = newRevealCode(12n, true)
  expect(saveRevealCode(code, JUROR)).toBe(true)
  expect(loadRevealCode(12n, JUROR)).toBe(code)
  expect(loadRevealCode(12n, JUROR.toLowerCase() as Address)).toBe(code)
})

test('another juror on the same device never gets this code, and another challenge neither', () => {
  const code = newRevealCode(12n, false)
  saveRevealCode(code, JUROR)
  expect(loadRevealCode(12n, OTHER)).toBeNull()
  expect(loadRevealCode(13n, JUROR)).toBeNull()
})

test('a code is kept for the challenge it names', () => {
  saveRevealCode(newRevealCode(12n, true), JUROR)
  saveRevealCode(newRevealCode(13n, false), JUROR)
  expect(parseRevealCode(loadRevealCode(12n, JUROR) ?? '')?.challengeId).toBe(12n)
  expect(parseRevealCode(loadRevealCode(13n, JUROR) ?? '')?.challengeId).toBe(13n)
})

test('saving a code that is not one is refused, and nothing is stored', () => {
  expect(saveRevealCode('nonsense', JUROR)).toBe(false)
  expect(localStorage.length).toBe(0)
})

test('a code stored under the key of another challenge is not handed back', () => {
  const code = newRevealCode(99n, true)
  saveRevealCode(code, JUROR)
  const key = Object.keys(localStorage)[0] as string
  const value = localStorage.getItem(key) as string
  localStorage.clear()
  localStorage.setItem(key.replace(/99$/, '12'), value)
  expect(loadRevealCode(12n, JUROR)).toBeNull()
})

test('a browser that refuses to store says so instead of throwing', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  expect(saveRevealCode(newRevealCode(12n, true), JUROR)).toBe(false)
  vi.restoreAllMocks()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError')
  })
  expect(loadRevealCode(12n, JUROR)).toBeNull()
})

test('nothing is printed to the console while a code is made, saved or loaded', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}))
  const code = newRevealCode(12n, true)
  saveRevealCode(code, JUROR)
  loadRevealCode(12n, JUROR)
  commitHashFor(code, JUROR)
  parseRevealCode(code)
  for (const spy of spies) expect(spy).not.toHaveBeenCalled()
})

// ---- review round: a second code never replaces the one that matches the commit -----------

test('a second code for the same challenge and juror does not replace the first', () => {
  const first = newRevealCode(12n, true)
  const second = newRevealCode(12n, false)
  saveRevealCode(first, JUROR)
  saveRevealCode(second, JUROR)
  expect(loadRevealCodes(12n, JUROR)).toEqual([first, second])
  expect(loadRevealCode(12n, JUROR, commitHashFor(first, JUROR))).toBe(first)
  expect(loadRevealCode(12n, JUROR, commitHashFor(second, JUROR))).toBe(second)
})

test('without a commit hash the newest code is handed back', () => {
  const first = newRevealCode(12n, true)
  const second = newRevealCode(12n, true)
  saveRevealCode(first, JUROR)
  saveRevealCode(second, JUROR)
  expect(loadRevealCode(12n, JUROR)).toBe(second)
})

test('a commit hash that no kept code matches gives nothing, and so does another juror', () => {
  const code = newRevealCode(12n, true)
  saveRevealCode(code, JUROR)
  expect(loadRevealCode(12n, JUROR, commitHashFor(newRevealCode(12n, true), JUROR))).toBeNull()
  expect(loadRevealCode(12n, JUROR, commitHashFor(code, OTHER))).toBeNull()
})

test('the same code saved twice is kept once', () => {
  const code = newRevealCode(12n, true)
  saveRevealCode(code, JUROR)
  saveRevealCode(code, JUROR)
  expect(loadRevealCodes(12n, JUROR)).toEqual([code])
})

test('the codes of fifty attempts are kept and the oldest go first', () => {
  const codes = Array.from({ length: 60 }, () => newRevealCode(12n, true))
  for (const code of codes) saveRevealCode(code, JUROR)
  expect(loadRevealCodes(12n, JUROR)).toEqual(codes.slice(10))
})

test('a stored value that is not a list of codes is ignored, and a new code starts a clean list', () => {
  const code = newRevealCode(12n, true)
  saveRevealCode(code, JUROR)
  const key = Object.keys(localStorage)[0] as string
  localStorage.setItem(key, '{"not":"a list"}')
  expect(loadRevealCodes(12n, JUROR)).toEqual([])
  localStorage.setItem(key, 'garbage')
  expect(loadRevealCode(12n, JUROR)).toBeNull()
  expect(saveRevealCode(code, JUROR)).toBe(true)
  expect(loadRevealCodes(12n, JUROR)).toEqual([code])
})

test('entries of the list that are not codes of this challenge are left out', () => {
  const mine = newRevealCode(12n, true)
  saveRevealCode(mine, JUROR)
  const key = Object.keys(localStorage)[0] as string
  localStorage.setItem(key, JSON.stringify([mine, 'nonsense', newRevealCode(13n, true), 7]))
  expect(loadRevealCodes(12n, JUROR)).toEqual([mine])
})

test('the browser is asked up front whether it can keep a code, and it leaves nothing behind', () => {
  expect(canKeepRevealCode()).toBe(true)
  expect(localStorage.length).toBe(0)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  expect(canKeepRevealCode()).toBe(false)
})
