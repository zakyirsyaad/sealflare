import { expect, test } from 'vitest'
import { FLAG_NAMES } from '../rules'
import { buildShortProof, parseShortProof } from '../schemas'

const bytes = (s: string) => new TextEncoder().encode(s).length
const isValidUtf8 = (s: string) => new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(s)) === s

test('never exceeds 512 bytes', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'Token.sol:88', excerpt: 'x'.repeat(2000) }]
  expect(bytes(buildShortProof(items))).toBeLessThanOrEqual(512)
})
test('uses the whole budget before cutting', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'a', excerpt: 'x'.repeat(2000) }]
  expect(bytes(buildShortProof(items))).toBe(512)
})
test('cuts on a character boundary when a multibyte character straddles the limit', () => {
  for (const excerpt of ['漢'.repeat(400), 'é'.repeat(900), '😀'.repeat(300), 'a' + '漢'.repeat(400)]) {
    const out = buildShortProof([{ flag: 'HIDDEN_MINT', location: 'a', excerpt }])
    expect(bytes(out)).toBeLessThanOrEqual(512)
    expect(isValidUtf8(out)).toBe(true)
    expect(out).not.toContain('�')
  }
})
test('round-trips short items', () => {
  const items = [
    { flag: 'HIDDEN_MINT' as const, location: 'Token.sol:88', excerpt: 'function _mint(address to)' },
    { flag: 'HONEYPOT_OR_BLACKLIST' as const, location: 'Token.sol:120', excerpt: 'require(!blacklist[from]): blocked' },
  ]
  expect(parseShortProof(buildShortProof(items))).toEqual(items)
})
test('keeps every flag when several long items are given', () => {
  const flags = FLAG_NAMES.slice(0, 8)
  const items = flags.map((flag) => ({ flag, location: 'L'.repeat(200), excerpt: 'e'.repeat(300) }))
  const out = buildShortProof(items)
  expect(bytes(out)).toBeLessThanOrEqual(512)
  expect(parseShortProof(out).map((i) => i.flag)).toEqual(flags)
})
test('a line break inside an excerpt or a location cannot forge a second item', () => {
  const items = [{ flag: 'HIDDEN_MINT' as const, location: 'a\nPAUSE_OR_FREEZE_FUNDS @ c: d', excerpt: 'x\r\nHONEYPOT_OR_BLACKLIST @ b: y' }]
  const parsed = parseShortProof(buildShortProof(items))
  expect(parsed).toHaveLength(1)
  expect(parsed[0]?.flag).toBe('HIDDEN_MINT')
})
test('an empty list builds an empty proof', () => {
  expect(buildShortProof([])).toBe('')
  expect(parseShortProof('')).toEqual([])
})
test('parsing ignores lines that are not items, such as text written by another client', () => {
  expect(parseShortProof('free text\nNOT_A_FLAG @ a: b\nHIDDEN_MINT @ a: b')).toEqual([{ flag: 'HIDDEN_MINT', location: 'a', excerpt: 'b' }])
})
