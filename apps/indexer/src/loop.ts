import type { Address, Hex, Log, PublicClient } from 'viem'
import type { Db } from '@sealflare/internal/db'
import { assertCursorStillOnChain, readCursor, writeCursor } from './cursor'
import { decodeCoreLogs, toJsonValue, type TimedEvent } from './decode'
import { applyCoreEvent } from './handlers/core'

/** How many blocks the indexer reads in one range. */
export const DEFAULT_BATCH = 2000

export interface IndexOnceDeps {
  client: PublicClient
  sql: Db
  addresses: { core: Address }
  batch?: number
  /**
   * The block Core was deployed in. The first read starts here when there is no cursor yet, so a
   * new database does not walk the chain from block 0. A cursor always wins over it.
   */
  startBlock?: bigint
}

export interface IndexOnceResult {
  /** The first block of the range that was read. */
  from: bigint
  /** The last block of the range that was read. */
  to: bigint
  /** How many events the range held. */
  events: number
}

/**
 * Reads the Core events of the next range and writes them to the database.
 *
 * The range stops at the last final block, so the indexer never reads a block the chain may
 * still change. The events, the raw log and the cursor go into one transaction, so a failure
 * anywhere leaves the cursor where it was and the range is read again next time.
 */
export async function indexOnce(deps: IndexOnceDeps): Promise<IndexOnceResult> {
  const batch = BigInt(deps.batch ?? DEFAULT_BATCH)
  const head = await deps.client.getBlock({ blockTag: 'finalized' })
  const finalized = head.number

  const cursorId = deps.addresses.core.toLowerCase()
  const cursor = await readCursor(deps.sql, cursorId)
  if (cursor) await assertCursorStillOnChain(deps.client, cursor)

  const from = cursor ? cursor.lastBlock + 1n : (deps.startBlock ?? 0n)
  if (from > finalized) return { from: finalized + 1n, to: finalized, events: 0 }
  const to = from + batch - 1n < finalized ? from + batch - 1n : finalized

  const logs = await deps.client.getLogs({ address: deps.addresses.core, fromBlock: from, toBlock: to })
  const events = await decodeRange(deps.client, logs)
  const lastBlockHash = await blockHashAt(deps.client, to)

  await deps.sql.transaction(async (tx) => {
    for (const event of events) {
      if (!(await recordEvent(tx, event))) continue
      await applyCoreEvent(tx, event)
    }
    await writeCursor(tx, cursorId, to, lastBlockHash)
  })

  return { from, to, events: events.length }
}

/** Decodes the logs of a range and gives every event the time of the block it was mined in. */
async function decodeRange(client: PublicClient, logs: readonly Log[]): Promise<TimedEvent[]> {
  const decoded = decodeCoreLogs(logs)
  const times = new Map<bigint, Date>()
  for (const event of decoded) {
    if (times.has(event.blockNumber)) continue
    const block = await client.getBlock({ blockNumber: event.blockNumber })
    times.set(event.blockNumber, new Date(Number(block.timestamp) * 1000))
  }
  return decoded.map((event) => {
    const at = times.get(event.blockNumber)
    if (!at) throw new Error(`The block ${event.blockNumber} of an event has no time.`)
    return { ...event, at }
  })
}

/**
 * Writes the raw log. The row says whether the event was read before, so a range that is read
 * twice does not count its votes twice.
 */
async function recordEvent(tx: Db, event: TimedEvent): Promise<boolean> {
  const rows = await tx.query<{ tx_hash: string }>(
    `INSERT INTO events (tx_hash, log_index, block_number, block_hash, contract, name, args)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, log_index) DO NOTHING
     RETURNING tx_hash`,
    [
      event.txHash,
      event.logIndex,
      event.blockNumber.toString(),
      event.blockHash,
      event.contract.toLowerCase(),
      event.name,
      JSON.stringify(toJsonValue(event.args)),
    ],
  )
  return rows.length > 0
}

async function blockHashAt(client: PublicClient, blockNumber: bigint): Promise<Hex> {
  const block = await client.getBlock({ blockNumber })
  if (!block.hash) throw new Error(`The block ${blockNumber} has no hash.`)
  return block.hash
}
