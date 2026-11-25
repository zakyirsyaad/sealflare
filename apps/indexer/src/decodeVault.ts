import { parseEventLogs, type Address, type Hex, type Log } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { withoutNul, type EventBase } from './decode'

/**
 * The events of the Vault.
 *
 * The shape of every event comes from the frozen interface `contracts/src/interfaces/IVault.sol`,
 * so the ABI in `shared/abi` is the only source.
 */

export type BondDeposited = EventBase & {
  name: 'BondDeposited'
  args: { targetId: Hex; depositor: Address; amount: bigint; total: bigint }
}

export type BondWithdrawalRequested = EventBase & {
  name: 'BondWithdrawalRequested'
  args: { targetId: Hex; depositor: Address; availableAt: bigint }
}

export type BondWithdrawn = EventBase & {
  name: 'BondWithdrawn'
  args: { targetId: Hex; depositor: Address; amount: bigint }
}

export type BondLocked = EventBase & {
  name: 'BondLocked'
  args: { challengeId: bigint; targetId: Hex; depositor: Address; amount: bigint }
}

export type BondSettled = EventBase & {
  name: 'BondSettled'
  args: { challengeId: bigint; targetId: Hex; depositor: Address; slashed: bigint; released: bigint }
}

export type StakeDeposited = EventBase & {
  name: 'StakeDeposited'
  args: { challengeId: bigint; account: Address; amount: bigint }
}

export type Distributed = EventBase & {
  name: 'Distributed'
  args: { challengeId: bigint; recipient: Address; amount: bigint }
}

export type BountyCreated = EventBase & {
  name: 'BountyCreated'
  args: { id: bigint; targetId: Hex; requester: Address; slots: number; amount: bigint; startIndex: number }
}

export type BountySettled = EventBase & {
  name: 'BountySettled'
  args: {
    id: bigint
    alignedVerdictMask: number
    filled: number
    paidPerSlot: bigint
    refunded: bigint
    fee: bigint
  }
}

export type BalanceCredited = EventBase & {
  name: 'BalanceCredited'
  args: { account: Address; amount: bigint }
}

export type Withdrawn = EventBase & {
  name: 'Withdrawn'
  args: { account: Address; amount: bigint }
}

export type VaultEvent =
  | BondDeposited
  | BondWithdrawalRequested
  | BondWithdrawn
  | BondLocked
  | BondSettled
  | StakeDeposited
  | Distributed
  | BountyCreated
  | BountySettled
  | BalanceCredited
  | Withdrawn

/** A Vault event with the time of the block it was mined in. */
export type TimedVaultEvent = VaultEvent & { at: Date }

const BY_NAME = {
  BondDeposited: 'BondDeposited',
  BondWithdrawalRequested: 'BondWithdrawalRequested',
  BondWithdrawn: 'BondWithdrawn',
  BondLocked: 'BondLocked',
  BondSettled: 'BondSettled',
  StakeDeposited: 'StakeDeposited',
  Distributed: 'Distributed',
  BountyCreated: 'BountyCreated',
  BountySettled: 'BountySettled',
  BalanceCredited: 'BalanceCredited',
  Withdrawn: 'Withdrawn',
} as const

/**
 * Reads the Vault events out of the logs of one range.
 *
 * A log that is not a Vault event is left out, and the events come back in the order the chain
 * has them.
 */
export function decodeVaultLogs(logs: readonly Log[]): VaultEvent[] {
  const parsed = parseEventLogs({ abi: vaultAbi, logs: logs as Log[] })
  return parsed.map((entry) => {
    const name = BY_NAME[entry.eventName as keyof typeof BY_NAME]
    if (!name) throw new Error(`The Vault contract emitted an event the indexer does not know: ${entry.eventName}`)
    return {
      name,
      args: withoutNul(entry.args),
      txHash: entry.transactionHash,
      logIndex: entry.logIndex,
      blockNumber: entry.blockNumber,
      blockHash: entry.blockHash,
      contract: entry.address,
    } as VaultEvent
  })
}
