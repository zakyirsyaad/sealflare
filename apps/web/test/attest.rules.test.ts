import { expect, test } from 'vitest'
import { FLAGS } from '@sealflare/shared/rules'
import { parseShortProof } from '@sealflare/shared/schemas'
import { addFlag, canReview, chooseVerdict, emptyChoice, provedFlags, setQuote, shortProofOf } from '../components/attest/choice'
import { attestAvailability } from '../components/attest/availability'
import { bundleChanged, targetWordOf } from '../server/target'
import { contractWord } from '../lib/targetWord'
import { address, bundle, contractScan, hiddenMint, skillScan, targetId, unverified, word } from './attest.fixtures'

const proved = (choice: ReturnType<typeof chooseVerdict>, flagsScan = contractScan()) => provedFlags(choice, flagsScan, targetId)

test('Safe with a flag cannot be submitted', () => {
  const choice = { ...addFlag(chooseVerdict('SAFE', 0), 'UNVERIFIED_SOURCE'), verdict: 'SAFE' as const }
  expect(canReview(choice, proved(choice), 'SMART_CONTRACT')).toBe(false)
})

test('a flag outside the mask of the target type cannot be submitted', () => {
  // A skill flag on a contract, and a contract flag on a skill.
  const onContract = { ...emptyChoice, verdict: 'CAUTION' as const, flags: 0x0100, quotes: {} }
  const onSkill = { ...emptyChoice, verdict: 'CAUTION' as const, flags: FLAGS.HIDDEN_MINT, quotes: {} }
  expect(canReview(onContract, 0x0100, 'SMART_CONTRACT')).toBe(false)
  expect(canReview(onSkill, FLAGS.HIDDEN_MINT, 'AI_SKILL_BUNDLE')).toBe(false)
})

test('Caution with a proved flag of its own type may be submitted', () => {
  const choice = chooseVerdict('CAUTION', FLAGS.UNVERIFIED_SOURCE)
  expect(canReview(choice, proved(choice), 'SMART_CONTRACT')).toBe(true)
})

test('a finding with an empty excerpt is not proved, so the Guardian has to quote it', () => {
  const report = contractScan([{ ...unverified, excerpt: '   ' }])
  const choice = chooseVerdict('CAUTION', report.flags)
  expect(proved(choice, report)).toBe(0)
  expect(canReview(choice, proved(choice, report), 'SMART_CONTRACT')).toBe(false)
  const quoted = setQuote(choice, 'UNVERIFIED_SOURCE', 'not verified')
  expect(canReview(quoted, proved(quoted, report), 'SMART_CONTRACT')).toBe(true)
  expect(shortProofOf(quoted.flags, quoted.quotes, report)).toContain('not verified')
})

test('no line of the proof is empty, even when the excerpts have to be cut to fit', () => {
  const long = 'x'.repeat(500)
  const report = contractScan([
    { ...unverified, excerpt: long },
    { ...hiddenMint, excerpt: long },
  ])
  const choice = chooseVerdict('DANGER', report.flags)
  const lines = parseShortProof(shortProofOf(choice.flags, choice.quotes, report))
  expect(lines).toHaveLength(2)
  for (const line of lines) expect(line.excerpt.trim()).not.toBe('')
})

test('a contract word is the address in the last twenty bytes', () => {
  expect(contractWord(address)).toBe(word)
  expect(contractWord('0x1234')).toBeNull()
})

test('the word of a skill is its bundle hash, the word of a contract its padded address', () => {
  expect(targetWordOf(null, skillScan(), false)).toBe(bundle)
  expect(targetWordOf(null, contractScan(), true)).toBe(word)
  expect(targetWordOf(null, null, true)).toBeNull()
})

test('a skill changed only when the scanned bundle differs from the sealed one', () => {
  const sealed = { targetType: 'AI_SKILL_BUNDLE', target: bundle } as never
  expect(bundleChanged(sealed, skillScan())).toBe(false)
  expect(bundleChanged(sealed, skillScan(`0x${'99'.repeat(32)}`))).toBe(true)
  expect(bundleChanged(null, skillScan())).toBe(false)
})

const holder = { kind: 'holder', attestationsLeft: 3, tier: 'UNRATED', targetType: 'AI_SKILL_BUNDLE', bundleChanged: false, previous: null } as const

test('a skill is never closed by the tier, only by its bundle', () => {
  expect(attestAvailability({ ...holder, tier: 'STALE_CODEHASH_DRIFT' }).kind).toBe('code-changed')
  expect(attestAvailability({ ...holder, bundleChanged: true }).kind).toBe('skill-changed')
  expect(attestAvailability(holder).kind).toBe('ready')
})

test('without a wallet the connect branch comes before the changed-code branch', () => {
  const input = { ...holder, kind: 'no-wallet', tier: 'STALE_CODEHASH_DRIFT', targetType: 'SMART_CONTRACT' } as const
  expect(attestAvailability(input).kind).toBe('no-wallet')
})
