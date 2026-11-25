import { SignalGroup } from '@sealflare/shared/schemas'

/** One vote, as the indexer stored it. */
export interface SignalVote {
  verdict: 'SAFE' | 'CAUTION' | 'DANGER'
  /** The frozen vote weight W(S), 0 to 5. */
  weight: number
  /** The bitmask of the flags the vote carried. */
  flags: number
}

/** The votes of one verdict and one weight, counted by the database. */
export interface SignalTally {
  verdict: 'SAFE' | 'CAUTION' | 'DANGER'
  weight: number
  /** How many votes the group holds. */
  votes: number
  /** The total weight of the votes in the group. */
  totalWeight: number
  /** The union of the flags of the votes in the group. */
  flags: number
}

interface Tally {
  votes: { safe: number; caution: number; danger: number }
  weight: { safe: number; caution: number; danger: number }
  flags: number
}

const emptyTally = (): Tally => ({
  votes: { safe: 0, caution: 0, danger: 0 },
  weight: { safe: 0, caution: 0, danger: 0 },
  flags: 0,
})

/** The name of a verdict in the tally. The database only holds the three verdicts. */
function keyOf(verdict: string): 'safe' | 'caution' | 'danger' {
  if (verdict === 'SAFE') return 'safe'
  if (verdict === 'CAUTION') return 'caution'
  if (verdict === 'DANGER') return 'danger'
  throw new Error(`the vote has the verdict ${verdict}, which the read model does not know`)
}

/**
 * The community signal of a target, split into the two rows the interface shows.
 *
 * A new Agent ID holder votes with weight 1 and an experienced Guardian votes with weight 2 or
 * more. A vote with weight 0 counts as a new holder: it carries no standing, so it does not
 * belong to the experienced Guardians, and it stays visible in the counts.
 *
 * The signal is never collapsed into one number, and it never says a target is safe.
 */
export function signalOf(rows: readonly SignalVote[]): { newIds: SignalGroup; guardians: SignalGroup } {
  const newIds = emptyTally()
  const guardians = emptyTally()
  for (const row of rows) {
    const tally = row.weight >= 2 ? guardians : newIds
    const key = keyOf(row.verdict)
    tally.votes[key] += 1
    tally.weight[key] += row.weight
    tally.flags |= row.flags
  }
  return { newIds, guardians }
}

/**
 * The same signal, from votes the database already counted.
 *
 * The grouping is by verdict and weight, so the two rows of the signal are put together again
 * here. A group of weight 0 belongs to the new holders, like a single vote of weight 0 does.
 */
export function signalOfTallies(tallies: readonly SignalTally[]): { newIds: SignalGroup; guardians: SignalGroup } {
  const newIds = emptyTally()
  const guardians = emptyTally()
  for (const group of tallies) {
    const tally = group.weight >= 2 ? guardians : newIds
    const key = keyOf(group.verdict)
    tally.votes[key] += group.votes
    tally.weight[key] += group.totalWeight
    tally.flags |= group.flags
  }
  return { newIds, guardians }
}
