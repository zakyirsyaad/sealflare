import type { PublicClient } from 'viem'

/**
 * The chain under the indexer is not the chain the database was built from, or not the chain the
 * indexer was told to read.
 *
 * This is not a passing RPC error. Reading the same range again will fail the same way, so the
 * process stops instead of retrying, and the restart or alert of whoever runs it fires.
 */
export class ChainMismatchError extends Error {
  override readonly name = 'ChainMismatchError'
}

/** Stops the indexer if the RPC node serves another chain than `CHAIN_ID` says. */
export async function assertChainId(client: PublicClient, expected: number): Promise<void> {
  const actual = await client.getChainId()
  if (actual !== expected) {
    throw new ChainMismatchError(
      `CHAIN_ID is ${expected} but the RPC node reports chain ${actual}. ` +
        `The indexer stops so it does not write events from the wrong chain into the database.`,
    )
  }
}
