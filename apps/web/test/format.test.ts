import { describe, expect, test } from 'vitest'
import { TRUST_TIERS } from '@sealflare/shared/rules'
import { shortAddress, formatBnb, formatUtc, timeLeft, tierLabel, tierReason } from '../lib/format'
describe('formatting', () => {
  test('shortAddress keeps six and four characters', () => expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678'))
  test.each([['0', '0'], ['10000000000000001', '0.010000000000000001'], [1n, '0.000000000000000001'], [123400000000000000000000n, '123400']])('formats %s wei exactly', (value, expected) => expect(formatBnb(value)).toBe(expected))
  test.each(['1.5', '-1', 'oops', ''])('rejects invalid wei %s', value => expect(() => formatBnb(value)).toThrow())
  test('timeLeft clamps elapsed dates and formats hours and minutes', () => {
    const now = new Date('2026-11-22T00:00:00Z')
    expect(timeLeft(new Date('2026-11-22T04:12:00Z'), now)).toBe('4h 12m')
    expect(timeLeft(new Date('2026-11-21'), now)).toBe('0h 0m')
    expect(timeLeft(new Date(now.getTime() + 59000), now)).toBe('0h 1m')
    expect(() => timeLeft(new Date('bad'), now)).toThrow()
  })
  test('formatUtc prints an absolute UTC time from Unix seconds, as a number or a bigint', () => {
    const seconds = Date.UTC(2026, 10, 26, 0, 5) / 1000
    expect(formatUtc(seconds)).toBe('2026-11-26 00:05 UTC')
    expect(formatUtc(BigInt(seconds))).toBe('2026-11-26 00:05 UTC')
    expect(() => formatUtc(Number.NaN)).toThrow()
  })
  test('every frozen tier has a plain English label and explanation', () => {
    expect(TRUST_TIERS.map(tierLabel)).toEqual(['Unrated', 'Community safe', 'Warranty backed safe', 'Caution flagged', 'Under dispute', 'Confirmed danger', 'Modified since audit'])
    for (const tier of TRUST_TIERS) expect(tierReason({ tier, hasDelegatecall: false })).toMatch(/\.$/)
    expect(tierReason({ tier: 'CAUTION_FLAGGED', hasDelegatecall: true })).toContain('proxy')
    expect(() => tierLabel('UNKNOWN' as never)).toThrow()
  })
})
