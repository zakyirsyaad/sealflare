import type { Hex, PublicClient } from 'viem'
import type { Db } from '@sealflare/internal/db'
import { ChainMismatchError } from './chain'

export interface Cursor {
  id: string
  lastBlock: bigint
  lastBlockHash: Hex
}

/**
 * The id of the cursor of a set of contracts.
 *
 * A range covers every contract that is read, so the cursor belongs to the whole set. A database
 * that ran with the Core alone has a cursor of that set, and a run that also reads the Court and
 * the Vault does not find it: it reads from the start block again, instead of skipping the events
 * of the two new contracts. The events the Core already wrote are skipped by the raw log. The id of
 * a Core alone is its address, so an existing database of that kind keeps its cursor.
 */
export function cursorIdOf(addresses: { core: string; court?: string | null; vault?: string | null }): string {
  const core = addresses.core.toLowerCase()
  if (!addresses.court && !addresses.vault) return core
  return [core, addresses.court?.toLowerCase() ?? '-', addresses.vault?.toLowerCase() ?? '-'].join(':')
}

/** Reads where the indexer stopped. A chain that was never indexed has no cursor yet. */
export async function readCursor(db: Db, id: string): Promise<Cursor | null> {
  const rows = await db.query<{ id: string; last_block: string; last_block_hash: string }>(
    'SELECT id, last_block, last_block_hash FROM cursor WHERE id = $1',
    [id],
  )
  const row = rows[0]
  if (!row) return null
  return { id: row.id, lastBlock: BigInt(row.last_block), lastBlockHash: row.last_block_hash as Hex }
}

/** Writes where the indexer stopped. It goes in the same transaction as the events it read. */
export async function writeCursor(tx: Db, id: string, lastBlock: bigint, lastBlockHash: Hex): Promise<void> {
  await tx.query(
    `INSERT INTO cursor (id, last_block, last_block_hash) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block, last_block_hash = EXCLUDED.last_block_hash`,
    [id, lastBlock.toString(), lastBlockHash],
  )
}

/**
 * Checks that the block the indexer stopped at is still the block it read.
 *
 * The indexer only reads final blocks, so the chain should not change under it. If it does, the
 * indexer stops with a clear message rather than writing events that belong to another chain.
 * The error is a `ChainMismatchError`, which the process does not retry.
 */
export async function assertCursorStillOnChain(client: PublicClient, cursor: Cursor): Promise<void> {
  const block = await client.getBlock({ blockNumber: cursor.lastBlock })
  if (block.hash !== cursor.lastBlockHash) {
    throw new ChainMismatchError(
      `The chain no longer has the block ${cursor.lastBlock} the indexer read. ` +
        `The indexer expected ${cursor.lastBlockHash} and found ${block.hash ?? 'no hash'}. ` +
        `The indexer stops here so it does not write events from another chain.`,
    )
  }
}
