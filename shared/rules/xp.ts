import type { Verdict } from './flags'

export const XP = {
  EARLY_SAFE: 2,
  CONFIRMING_SAFE: 1,
  DANGER_CONFIRMED: 5,
  SAFE_ON_DANGER: -15,
  JUROR_MAJORITY: 3,
  CHALLENGER_WON: 5,
  CHALLENGER_LOST: -5,
} as const

export const EARLY_SAFE_SLOTS = 3
export const REWARDED_SAFE_SLOTS = 10

export type AttestationXpInput = {
  verdict: Verdict
  /** 1-based position among SAFE attestations on the target; 0 when the verdict is not SAFE. */
  safeOrdinal: number
  /** The attestation survived its 48 hour window. */
  eligible: boolean
  confirmedDanger: boolean
}

export function attestationXp(input: AttestationXpInput): number {
  if (input.verdict === 'CAUTION') return 0
  if (input.verdict === 'DANGER') return input.confirmedDanger ? XP.DANGER_CONFIRMED : 0
  // A SAFE vote on a confirmed danger earns nothing here. Its penalty is attestationPenalty,
  // applied by applyPenalties, so it can never be charged twice.
  if (input.confirmedDanger) return 0
  if (!input.eligible || input.safeOrdinal < 1) return 0
  if (input.safeOrdinal <= EARLY_SAFE_SLOTS) return XP.EARLY_SAFE
  if (input.safeOrdinal <= REWARDED_SAFE_SLOTS) return XP.CONFIRMING_SAFE
  return 0
}

/** What applyPenalties charges: -15 for a SAFE vote on a target later confirmed dangerous, else 0. */
export function attestationPenalty(verdict: Verdict, confirmedDanger: boolean): number {
  return verdict === 'SAFE' && confirmedDanger ? XP.SAFE_ON_DANGER : 0
}
