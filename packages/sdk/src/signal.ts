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
    const group = groupOf(attestation.weight, newIds, guardians)
    group.votes[attestation.verdict.toLowerCase() as 'safe' | 'caution' | 'danger'] += 1
    group.weight[attestation.verdict.toLowerCase() as 'safe' | 'caution' | 'danger'] += attestation.weight
    group.flags |= attestation.flags
  }
  return { newIds: SignalGroup.parse(newIds), guardians: SignalGroup.parse(guardians) }
}

/**
 * The group of one vote.
 *
 * A weight of 1 is a new Agent ID, a weight of 2 or more is an experienced Guardian. A weight of 0
 * is a Guardian whose score went negative, so it belongs with the Guardians and never with the new
 * Agent IDs: it adds no weight, but its verdict and its flags stay visible.
 */
function groupOf(weight: number, newIds: SignalGroup, guardians: SignalGroup): SignalGroup {
  return weight === 1 ? newIds : guardians
}
