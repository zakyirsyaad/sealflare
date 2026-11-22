export const TARGET_TYPES = ['SMART_CONTRACT', 'AI_SKILL_BUNDLE'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

export const VERDICTS = ['SAFE', 'CAUTION', 'DANGER'] as const
export type Verdict = (typeof VERDICTS)[number]

export const FLAG_NAMES = [
  'UNVERIFIED_SOURCE',
  'HIDDEN_MINT',
  'PAUSE_OR_FREEZE_FUNDS',
  'MUTABLE_OR_HIGH_TAX',
  'HONEYPOT_OR_BLACKLIST',
  'UPGRADEABLE_NO_TIMELOCK',
  'UNPINNABLE_DELEGATECALL',
  'PERMIT_OR_DRAINER_PATTERN',
  'PROMPT_BYPASS_CONFIRMATION',
  'UNLIMITED_APPROVAL_REQUEST',
  'HIDDEN_FIXED_TRANSFER',
  'CREDENTIAL_OR_KEY_HARVESTING',
  'EXTERNAL_MUTABLE_DEPENDENCY',
  'TROJAN_HELPER_SCRIPT',
  'OBFUSCATED_UNICODE_INJECTION',
  'SANDBOX_FUZZ_FAILED',
] as const
export type FlagName = (typeof FLAG_NAMES)[number]

export const FLAGS = Object.fromEntries(FLAG_NAMES.map((name, bit) => [name, 2 ** bit])) as Record<FlagName, number>

export const CONTRACT_FLAGS_MASK = 0x00ff
export const SKILL_FLAGS_MASK = 0xff00

const maskOf = (targetType: TargetType): number =>
  targetType === 'SMART_CONTRACT' ? CONTRACT_FLAGS_MASK : SKILL_FLAGS_MASK

/** SAFE carries no flags; CAUTION and DANGER carry at least one, all within the target type's mask. */
export function isValidFlags(targetType: TargetType, verdict: Verdict, flags: number): boolean {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) return false
  if (verdict === 'SAFE') return flags === 0
  const mask = maskOf(targetType)
  return flags !== 0 && flags - (flags & mask) === 0
}

export function flagNames(flags: number): FlagName[] {
  return FLAG_NAMES.filter((name) => (flags & FLAGS[name]) !== 0)
}
