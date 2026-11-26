import type { Address } from 'viem'
import { addresses } from './addresses'
import { expectedChainId } from './config'

/** The phases of a dispute, in the order of the `ChallengePhase` enum of the contract. */
export const CHALLENGE_PHASES = ['NONE', 'COMMIT', 'REVEAL', 'AWAITING_CLOSE', 'CLOSED'] as const
export type ChallengePhase = (typeof CHALLENGE_PHASES)[number]

/** The outcomes of a dispute, in the order of the `ChallengeOutcome` enum of the contract. */
export const CHALLENGE_OUTCOMES = ['PENDING', 'UPHELD', 'REJECTED', 'TIED', 'EXPIRED'] as const
export type ChallengeOutcome = (typeof CHALLENGE_OUTCOMES)[number]

/** The phase the chain named, or null when it named none this code knows. */
export function phaseFromChain(value: unknown): ChallengePhase | null {
  if (typeof value !== 'number' && typeof value !== 'bigint') return null
  return CHALLENGE_PHASES[Number(value)] ?? null
}

/** The outcome the chain named, or null when it named none this code knows. */
export function outcomeFromChain(value: unknown): ChallengeOutcome | null {
  if (typeof value !== 'number' && typeof value !== 'bigint') return null
  return CHALLENGE_OUTCOMES[Number(value)] ?? null
}

/** The address of the Court, or null when the deployment names none. */
export function courtAddress(): Address | null {
  try {
    return addresses(expectedChainId).court
  } catch {
    return null
  }
}

/** The address of the registry, or null when the deployment names none. */
export function coreAddress(): Address | null {
  try {
    return addresses(expectedChainId).core
  } catch {
    return null
  }
}
