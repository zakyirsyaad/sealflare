import type { Address, Log, PublicClient } from 'viem'
import { decodeCoreLogs, type CoreEvent, type TimedEvent } from './decode'
import { decodeCourtLogs, type CourtEvent, type TimedCourtEvent } from './decodeCourt'
import { decodeVaultLogs, type TimedVaultEvent, type VaultEvent } from './decodeVault'

/**
 * The events of one range, of the three contracts the indexer reads.
 *
 * Every event keeps the contract it came from, so the right handler writes it.
 */
export type AnyEvent =
  | { kind: 'core'; event: TimedEvent }
  | { kind: 'court'; event: TimedCourtEvent }
  | { kind: 'vault'; event: TimedVaultEvent }

/** An event of the range, before it gets the time of its block. */
type Untimed =
  | { kind: 'core'; event: CoreEvent }
  | { kind: 'court'; event: CourtEvent }
  | { kind: 'vault'; event: VaultEvent }

/** The contracts the indexer reads. A contract that is not given is not read at all. */
export interface IndexedAddresses {
  core: Address
  court?: Address
  vault?: Address
}

/**
 * Reads the events of one range out of the logs of the chain.
 *
 * The logs of a range hold the events of the three contracts, so they are split by address and
 * read with the ABI of that contract. Every event gets the time of the block it was mined in,
 * and the events come back in the order the chain has them: first the block, then the place of
 * the log in that block.
 */
export async function decodeRange(
  client: PublicClient,
  logs: readonly Log[],
  addresses: IndexedAddresses,
): Promise<AnyEvent[]> {
  const groups = groupByAddress(logs, addresses)
  const decoded: Untimed[] = []

  for (const log of groups.core) {
    decoded.push(...decodeCoreLogs([log]).map((event) => ({ kind: 'core' as const, event })))
  }
  for (const log of groups.court) {
    decoded.push(...decodeCourtLogs([log]).map((event) => ({ kind: 'court' as const, event })))
  }
  for (const log of groups.vault) {
    decoded.push(...decodeVaultLogs([log]).map((event) => ({ kind: 'vault' as const, event })))
  }

  const times = await blockTimes(client, decoded)
  const events = decoded.map((entry) => withTime(entry, times))
  return events.sort((left, right) => {
    if (left.event.blockNumber !== right.event.blockNumber) {
      return left.event.blockNumber < right.event.blockNumber ? -1 : 1
    }
    return left.event.logIndex - right.event.logIndex
  })
}

/** The logs of the range, split by the contract they came from. */
function groupByAddress(
  logs: readonly Log[],
  addresses: IndexedAddresses,
): { core: Log[]; court: Log[]; vault: Log[] } {
  const core = addresses.core.toLowerCase()
  const court = addresses.court?.toLowerCase()
  const vault = addresses.vault?.toLowerCase()
  const groups = { core: [] as Log[], court: [] as Log[], vault: [] as Log[] }
  for (const log of logs) {
    const address = log.address.toLowerCase()
    if (address === core) groups.core.push(log)
    else if (address === court) groups.court.push(log)
    else if (address === vault) groups.vault.push(log)
  }
  return groups
}

/** The time of every block the range holds an event in. */
async function blockTimes(client: PublicClient, events: readonly Untimed[]): Promise<Map<bigint, Date>> {
  const times = new Map<bigint, Date>()
  for (const entry of events) {
    const number = entry.event.blockNumber
    if (times.has(number)) continue
    const block = await client.getBlock({ blockNumber: number })
    times.set(number, new Date(Number(block.timestamp) * 1000))
  }
  return times
}

/** The event with the time of its block. */
function withTime(entry: Untimed, times: Map<bigint, Date>): AnyEvent {
  const at = times.get(entry.event.blockNumber)
  if (!at) throw new Error(`The block ${entry.event.blockNumber} of an event has no time.`)
  if (entry.kind === 'core') return { kind: 'core', event: { ...entry.event, at } }
  if (entry.kind === 'court') return { kind: 'court', event: { ...entry.event, at } }
  return { kind: 'vault', event: { ...entry.event, at } }
}
