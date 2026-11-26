import { parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { withoutNul, type EventBase } from './decode'

/**
 * The events of the Court.
 *
 * The order of the enum values and the shape of every event come from the frozen interface
 * `contracts/src/interfaces/ICourt.sol`, so the ABI in `shared/abi` is the only source.
 */

export type ChallengeOpened = EventBase & {
  name: 'ChallengeOpened'
  args: {
    id: bigint
    targetId: Hex
    challenger: Address
    flags: number
    evidenceHash: Hex
    shortProof: Hex
    evidenceURI: string
    commitEndsAt: bigint
    revealEndsAt: bigint
  }
}

export type CounterEvidenceSubmitted = EventBase & {
  name: 'CounterEvidenceSubmitted'
  args: { id: bigint; publisher: Address; uri: string }
}

export type VoteCommitted = EventBase & {
  name: 'VoteCommitted'
  args: { id: bigint; juror: Address; weight: number }
}

export type VoteRevealed = EventBase & {
  name: 'VoteRevealed'
  args: { id: bigint; juror: Address; uphold: boolean; weight: number }
}

export type ChallengeResolved = EventBase & {
  name: 'ChallengeResolved'
  args: { id: bigint; outcome: number; upholdWeight: number; rejectWeight: number }
}

export type ChallengeExpired = EventBase & {
  name: 'ChallengeExpired'
  args: { id: bigint; reveals: number; forfeitBps: number }
}

export type CourtEvent =
  | ChallengeOpened
  | CounterEvidenceSubmitted
  | VoteCommitted
  | VoteRevealed
  | ChallengeResolved
  | ChallengeExpired

/** A Court event with the time of the block it was mined in. */
export type TimedCourtEvent = CourtEvent & { at: Date }

const BY_NAME = {
  ChallengeOpened: 'ChallengeOpened',
  CounterEvidenceSubmitted: 'CounterEvidenceSubmitted',
  VoteCommitted: 'VoteCommitted',
  VoteRevealed: 'VoteRevealed',
  ChallengeResolved: 'ChallengeResolved',
  ChallengeExpired: 'ChallengeExpired',
} as const

/**
 * Reads the Court events out of the logs of one range.
 *
 * A log that is not a Court event is left out, and the events come back in the order the chain
 * has them.
 */
export function decodeCourtLogs(logs: readonly Log[]): CourtEvent[] {
  const parsed = parseEventLogs({ abi: courtAbi, logs: logs as Log[] })
  return parsed.map((entry) => {
    const name = BY_NAME[entry.eventName as keyof typeof BY_NAME]
    if (!name) throw new Error(`The Court contract emitted an event the indexer does not know: ${entry.eventName}`)
    return {
      name,
      args: withoutNul(entry.args),
      txHash: entry.transactionHash,
      logIndex: entry.logIndex,
      blockNumber: entry.blockNumber,
      blockHash: entry.blockHash,
      contract: entry.address,
    } as CourtEvent
  })
}
