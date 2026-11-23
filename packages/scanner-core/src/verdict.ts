import type { FlagName, Verdict } from '@sealflare/shared/rules'
import type { Check, CheckId, Finding } from '@sealflare/shared/schemas'

/** S2: the nine severe flags. Every other FlagName is light by definition. */
const SEVERE_FLAG_LIST = [
  'HIDDEN_MINT',
  'HONEYPOT_OR_BLACKLIST',
  'PERMIT_OR_DRAINER_PATTERN',
  'PROMPT_BYPASS_CONFIRMATION',
  'UNLIMITED_APPROVAL_REQUEST',
  'HIDDEN_FIXED_TRANSFER',
  'CREDENTIAL_OR_KEY_HARVESTING',
  'TROJAN_HELPER_SCRIPT',
  'OBFUSCATED_UNICODE_INJECTION',
] as const satisfies readonly FlagName[]

export const SEVERE_FLAGS: ReadonlySet<FlagName> = new Set<FlagName>(SEVERE_FLAG_LIST)

/**
 * S1: DANGER for a severe finding, CAUTION for any other finding or any expected
 * check that did not pass, SAFE only when every expected check passed with no
 * finding. Mirrors the SAFE rule that ScanReport.superRefine enforces.
 */
export function suggestVerdict(
  checks: readonly Check[],
  findings: readonly Finding[],
  expected: readonly CheckId[],
): Verdict {
  if (findings.some((finding) => SEVERE_FLAGS.has(finding.flag))) return 'DANGER'
  if (findings.length > 0) return 'CAUTION'
  const passed = new Set(checks.filter((check) => check.status === 'passed').map((check) => check.id))
  const allPassed = expected.length > 0 && checks.length === expected.length && expected.every((id) => passed.has(id))
  return allPassed ? 'SAFE' : 'CAUTION'
}