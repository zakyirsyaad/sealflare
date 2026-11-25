import { TARGET_TYPES, VERDICTS } from '@sealflare/shared/rules'

/**
 * The order of the enums in `contracts/src/interfaces/Types.sol` is part of the frozen ABI, so a
 * number that travels on the wire names one of these.
 *
 * The target type and the verdict come from the shared rules, which carry the same order. The
 * publisher role and the challenge outcome have no shared list yet; their strings are the ones
 * the frozen read model accepts. `test/enums.test.ts` reads the frozen contract and checks that
 * every list here is still the order the contract uses.
 */
export const TARGET_TYPE_NAMES = TARGET_TYPES
export const VERDICT_NAMES = VERDICTS

export const PUBLISHER_ROLES = ['NONE', 'THIRD_PARTY_SPONSOR', 'VERIFIED_PUBLISHER'] as const
export const CHALLENGE_OUTCOMES = ['PENDING', 'UPHELD', 'REJECTED', 'TIED', 'EXPIRED'] as const

/**
 * The order of `ScoreReason` in `contracts/src/interfaces/Types.sol`. The reason is stored by
 * name, because it is read by people and not by the contracts.
 */
export const SCORE_REASONS = [
  'EARLY_SAFE',
  'CONFIRMING_SAFE',
  'DANGER_CONFIRMED',
  'SAFE_ON_DANGER',
  'JUROR_MAJORITY',
  'CHALLENGER_WON',
  'CHALLENGER_LOST',
] as const

export type PublisherRole = (typeof PUBLISHER_ROLES)[number]
export type ChallengeOutcome = (typeof CHALLENGE_OUTCOMES)[number]

/** Names the enum value of a number the contract sent, or null when the number is not one of ours. */
export function nameOf<T extends string>(names: readonly T[], value: number): T | null {
  return names[value] ?? null
}
