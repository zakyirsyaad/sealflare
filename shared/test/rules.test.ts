import { describe, expect, test } from 'vitest'
import weight from '../rules/vectors/weight.json'
import tier from '../rules/vectors/tier.json'
import xp from '../rules/vectors/xp.json'
import flags from '../rules/vectors/flags.json'
import constants from '../rules/vectors/constants.json'
import {
  CONSTANTS,
  FLAGS,
  type TierInput,
  type Verdict,
  attestationXp,
  flagNames,
  isValidFlags,
  tierOf,
  weightOf,
} from '../rules'

test.each(weight)('weightOf($score) is $weight', ({ score, weight }) => {
  expect(weightOf(score)).toBe(weight)
})

test.each(tier)('tierOf $name is $tier', ({ name, tier, tierIndex, ...input }) => {
  expect(tierOf(input satisfies TierInput)).toBe(tier)
})

test.each(xp)('attestationXp $verdict #$safeOrdinal is $xp', ({ xp, verdictIndex, verdict, ...rest }) => {
  expect(attestationXp({ verdict: verdict as Verdict, ...rest })).toBe(xp)
})

test.each(flags)('flag $name is bit $bit', ({ name, bit }) => {
  expect(FLAGS[name as keyof typeof FLAGS]).toBe(2 ** bit)
})

test('constants match the vector file', () => {
  expect(CONSTANTS.CHALLENGE_STAKE).toBe(BigInt(constants.CHALLENGE_STAKE))
  expect(CONSTANTS.JURY_STAKE).toBe(BigInt(constants.JURY_STAKE))
  expect(CONSTANTS.MAX_WARRANTY_BOND).toBe(BigInt(constants.MAX_WARRANTY_BOND))
  expect(CONSTANTS.MAX_BOUNTY).toBe(BigInt(constants.MAX_BOUNTY))
  expect(CONSTANTS.MAX_JURORS).toBe(Number(constants.MAX_JURORS))
  expect(CONSTANTS.EXPIRE_FORFEIT_BPS).toEqual([2000, 5000, 10000])
  for (const [key, value] of Object.entries(constants)) {
    if (typeof value !== 'string') continue
    expect(String(CONSTANTS[key as keyof typeof CONSTANTS]), key).toBe(value)
  }
})

describe('isValidFlags', () => {
  test('SAFE must carry no flags', () => {
    expect(isValidFlags('SMART_CONTRACT', 'SAFE', 0)).toBe(true)
    expect(isValidFlags('SMART_CONTRACT', 'SAFE', FLAGS.HIDDEN_MINT)).toBe(false)
  })
  test('CAUTION and DANGER need at least one flag', () => {
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', 0)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'CAUTION', FLAGS.EXTERNAL_MUTABLE_DEPENDENCY)).toBe(true)
  })
  test('rejects flags of the other target type and bits above 15', () => {
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', FLAGS.SANDBOX_FUZZ_FAILED)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'DANGER', FLAGS.HIDDEN_MINT)).toBe(false)
    expect(isValidFlags('AI_SKILL_BUNDLE', 'DANGER', 0x10000 | FLAGS.SANDBOX_FUZZ_FAILED)).toBe(false)
  })
  test('rejects negative and fractional values', () => {
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', -1)).toBe(false)
    expect(isValidFlags('SMART_CONTRACT', 'DANGER', 1.5)).toBe(false)
  })
})

test('flagNames lists set bits in bit order', () => {
  expect(flagNames(FLAGS.HIDDEN_MINT | FLAGS.UNVERIFIED_SOURCE)).toEqual(['UNVERIFIED_SOURCE', 'HIDDEN_MINT'])
})
