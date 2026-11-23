import { describe, expect, test } from 'vitest'
import { FLAG_NAMES, type FlagName } from '@sealflare/shared/rules'
import {
  CONTRACT_CHECK_IDS,
  SKILL_CHECK_IDS,
  type Check,
  type CheckId,
  type Finding,
} from '@sealflare/shared/schemas'
import { SEVERE_FLAGS, suggestVerdict } from '../src/verdict'

const allPassed = (ids: readonly CheckId[]): Check[] => ids.map((id) => ({ id, status: 'passed' }))

const withStatus = (id: CheckId, status: Check['status']): Check[] => {
  const contractIds: readonly CheckId[] = CONTRACT_CHECK_IDS
  const ids = contractIds.includes(id) ? CONTRACT_CHECK_IDS : SKILL_CHECK_IDS
  return ids.map((checkId) => ({ id: checkId, status: checkId === id ? status : 'passed' }))
}

const finding = (flag: FlagName): Finding => ({
  flag,
  checkId: 'helper_scripts',
  title: 'Test finding',
  location: 'SKILL.md:1',
  excerpt: 'proof',
})

describe('suggestVerdict', () => {
  test('SAFE only when every expected check passed and nothing was found', () => {
    expect(suggestVerdict(allPassed(SKILL_CHECK_IDS), [], SKILL_CHECK_IDS)).toBe('SAFE')
  })

  test('a missing, failed or skipped check caps the suggestion at CAUTION', () => {
    expect(suggestVerdict(allPassed(SKILL_CHECK_IDS).slice(1), [], SKILL_CHECK_IDS)).toBe('CAUTION')
    expect(suggestVerdict(withStatus('dry_run', 'skipped'), [], CONTRACT_CHECK_IDS)).toBe('CAUTION')
    expect(suggestVerdict(withStatus('source_verified', 'failed'), [], CONTRACT_CHECK_IDS)).toBe('CAUTION')
  })

  test('a severe finding suggests DANGER, a light one CAUTION', () => {
    const checks = allPassed(SKILL_CHECK_IDS)
    expect(suggestVerdict(checks, [finding('TROJAN_HELPER_SCRIPT')], SKILL_CHECK_IDS)).toBe('DANGER')
    expect(suggestVerdict(checks, [finding('EXTERNAL_MUTABLE_DEPENDENCY')], SKILL_CHECK_IDS)).toBe('CAUTION')
    expect(
      suggestVerdict(allPassed(CONTRACT_CHECK_IDS), [finding('UPGRADEABLE_NO_TIMELOCK')], CONTRACT_CHECK_IDS),
    ).toBe('CAUTION')
  })

  test('every flag is classed as severe or light, none is left out', () => {
    const severe = FLAG_NAMES.filter((f) => SEVERE_FLAGS.has(f))
    expect(severe).toHaveLength(9)
    expect(FLAG_NAMES.filter((f) => !SEVERE_FLAGS.has(f))).toHaveLength(FLAG_NAMES.length - 9)
    expect([...severe].sort()).toEqual([
      'CREDENTIAL_OR_KEY_HARVESTING',
      'HIDDEN_FIXED_TRANSFER',
      'HIDDEN_MINT',
      'HONEYPOT_OR_BLACKLIST',
      'OBFUSCATED_UNICODE_INJECTION',
      'PERMIT_OR_DRAINER_PATTERN',
      'PROMPT_BYPASS_CONFIRMATION',
      'TROJAN_HELPER_SCRIPT',
      'UNLIMITED_APPROVAL_REQUEST',
    ])
  })

  test('a flagged check without findings is still not SAFE', () => {
    expect(suggestVerdict(withStatus('dry_run', 'flagged'), [], CONTRACT_CHECK_IDS)).toBe('CAUTION')
  })

  test('a severe finding outranks missing checks', () => {
    expect(suggestVerdict([], [finding('HIDDEN_MINT')], CONTRACT_CHECK_IDS)).toBe('DANGER')
  })

  test('an empty expectation list never suggests SAFE', () => {
    expect(suggestVerdict([], [], [])).toBe('CAUTION')
  })
})