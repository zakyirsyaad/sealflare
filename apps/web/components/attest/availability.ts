import type { TargetType, TrustTier, Verdict } from '@sealflare/shared/rules'

/** What the attest button may do, and why it may not do more. */
export type AttestAvailability =
  | { kind: 'ready' }
  | { kind: 'checking' }
  | { kind: 'no-wallet' }
  | { kind: 'wrong-network' }
  | { kind: 'no-agent-id' }
  | { kind: 'already-attested'; verdict: Verdict; txHash: string }
  | { kind: 'quota-exhausted' }
  | { kind: 'code-changed' }
  | { kind: 'skill-changed' }

export type AvailabilityInput = {
  /** The state of the wallet, as `useUserState` names it. */
  kind: 'no-wallet' | 'wrong-network' | 'checking' | 'no-agent-id' | 'holder'
  /** The attestations the user has left today, when the chain knows them. */
  attestationsLeft?: number | null
  tier: TrustTier
  targetType: TargetType
  /** The scanned bundle is another bundle than the one the registry sealed. */
  bundleChanged: boolean
  /** The vote of this user on this target, when there is one. */
  previous: { verdict: Verdict; txHash: string } | null
}

/**
 * Whether the user may attest this target now.
 *
 * The order follows ux.md 6.4: the wallet comes first, then the vote that is already on the
 * chain, the quota, and last the target that changed. A target whose code changed closes the
 * vote, because the vote is bound to the old code.
 */
export function attestAvailability(input: AvailabilityInput): AttestAvailability {
  if (input.kind === 'no-wallet') return { kind: 'no-wallet' }
  if (input.kind === 'wrong-network') return { kind: 'wrong-network' }
  if (input.kind === 'checking') return { kind: 'checking' }
  if (input.kind === 'no-agent-id') return { kind: 'no-agent-id' }
  if (input.previous !== null) {
    return { kind: 'already-attested', verdict: input.previous.verdict, txHash: input.previous.txHash }
  }
  if (input.attestationsLeft === 0) return { kind: 'quota-exhausted' }
  if (input.bundleChanged && input.targetType === 'AI_SKILL_BUNDLE') return { kind: 'skill-changed' }
  if (input.tier === 'STALE_CODEHASH_DRIFT') return { kind: 'code-changed' }
  return { kind: 'ready' }
}

/** The verdicts a Guardian may pick. A target judged dangerous cannot be attested as safe. */
export function pickableVerdicts(tier: TrustTier): { SAFE: boolean; CAUTION: boolean; DANGER: boolean } {
  const confirmedDanger = tier === 'CONFIRMED_DANGER'
  return { SAFE: !confirmedDanger, CAUTION: true, DANGER: true }
}
