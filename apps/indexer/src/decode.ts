import { parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'

/** What every decoded event carries, whichever event it is. */
export interface EventBase {
  txHash: Hex
  logIndex: number
  blockNumber: bigint
  blockHash: Hex
  contract: Address
}

export type TargetCreated = EventBase & {
  name: 'TargetCreated'
  args: { targetId: Hex; targetType: number; target: Hex; pinnedCodehash: Hex }
}
export type GuardianCreated = EventBase & {
  name: 'GuardianCreated'
  args: { guardian: Address; createdAtBlock: bigint }
}
export type Attested = EventBase & {
  name: 'Attested'
  args: {
    targetId: Hex
    guardian: Address
    verdict: number
    flags: number
    weight: number
    index: number
    safeOrdinal: number
    evidenceHash: Hex
    shortProof: Hex
    evidenceURI: string
  }
}
export type PublisherBound = EventBase & {
  name: 'PublisherBound'
  args: { targetId: Hex; publisher: Address; role: number; method: number }
}
export type DelegatecallFlagged = EventBase & {
  name: 'DelegatecallFlagged'
  args: { targetId: Hex; caller: Address }
}
export type AttestationSettled = EventBase & {
  name: 'AttestationSettled'
  args: { targetId: Hex; index: number; delta: number }
}
export type ScoreChanged = EventBase & {
  name: 'ScoreChanged'
  args: { guardian: Address; targetId: Hex; delta: number; newScore: number; reason: number }
}
export type DisputeMarked = EventBase & {
  name: 'DisputeMarked'
  args: { targetId: Hex; challengeId: bigint }
}
export type VerdictApplied = EventBase & {
  name: 'VerdictApplied'
  args: { targetId: Hex; challengeId: bigint; outcome: number; flags: number }
}
export type ModulesSet = EventBase & {
  name: 'ModulesSet'
  args: { court: Address; vault: Address }
}

export type CoreEvent =
  | TargetCreated
  | GuardianCreated
  | Attested
  | PublisherBound
  | DelegatecallFlagged
  | AttestationSettled
  | ScoreChanged
  | DisputeMarked
  | VerdictApplied
  | ModulesSet

/** An event with the time of the block it was mined in. */
export type TimedEvent = CoreEvent & { at: Date }

const BY_NAME = {
  TargetCreated: 'TargetCreated',
  GuardianCreated: 'GuardianCreated',
  Attested: 'Attested',
  PublisherBound: 'PublisherBound',
  DelegatecallFlagged: 'DelegatecallFlagged',
  AttestationSettled: 'AttestationSettled',
  ScoreChanged: 'ScoreChanged',
  DisputeMarked: 'DisputeMarked',
  VerdictApplied: 'VerdictApplied',
  ModulesSet: 'ModulesSet',
} as const

/**
 * Reads the Core events out of the logs of one range. A log that is not a Core event is left
 * out, and the events come back in the order the chain has them.
 */
export function decodeCoreLogs(logs: readonly Log[]): CoreEvent[] {
  const parsed = parseEventLogs({ abi: coreAbi, logs: logs as Log[] })
  return parsed.map((entry) => {
    const name = BY_NAME[entry.eventName as keyof typeof BY_NAME]
    if (!name) throw new Error(`The Core contract emitted an event the indexer does not know: ${entry.eventName}`)
    return {
      name,
      args: entry.args,
      txHash: entry.transactionHash,
      logIndex: entry.logIndex,
      blockNumber: entry.blockNumber,
      blockHash: entry.blockHash,
      contract: entry.address,
    } as CoreEvent
  })
}

/**
 * Turns a value into something that can be stored as jsonb. A number too large for a JavaScript
 * number becomes a decimal string, so nothing is lost on the way into the database.
 */
export function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]))
  }
  return value
}
