import { SignalGroup } from '@sealflare/shared/schemas'
import type { OnChainAttestation } from './chain'

export type SignalSummary = { newIds: SignalGroup; guardians: SignalGroup }

function emptyGroup(): SignalGroup {
  return { votes: { safe: 0, caution: 0, danger: 0 }, weight: { safe: 0, caution: 0, danger: 0 }, flags: 0 }
}

/**
 * The signal is never collapsed into one number.
 *
 * A brand new Agent ID carries weight 1 and an experienced Guardian carries weight 2 or more, so
 * the two groups are counted apart: the votes, the combined weight and the flags of each group.
 */
export function splitSignal(attestations: readonly OnChainAttestation[]): SignalSummary {
  const newIds = emptyGroup()
  const guardians = emptyGroup()
  for (const attestation of attestations) {
    const group = attestation.weight <= 1 ? newIds : guardians
    group.votes[attestation.verdict.toLowerCase() as 'safe' | 'caution' | 'danger'] += 1
    group.weight[attestation.verdict.toLowerCase() as 'safe' | 'caution' | 'danger'] += attestation.weight
    group.flags |= attestation.flags
  }
  return { newIds: SignalGroup.parse(newIds), guardians: SignalGroup.parse(guardians) }
}
