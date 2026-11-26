import type { Hex } from 'viem'
import type { PublicClient } from 'viem'
import { copy } from '../copy'

/** A write that the chain did not accept. The message is written for people. */
export class WriteFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WriteFailed'
  }
}

type Client = Pick<PublicClient, 'waitForTransactionReceipt'>

/**
 * Waits for the receipt of a transaction. A write is only a success when the chain says so: a
 * transaction that was sent and reverted is a failure, and a transaction that cannot be read is
 * never shown as a success either.
 */
export async function confirmWrite(client: Client | undefined, hash: Hex): Promise<void> {
  if (client === undefined) throw new WriteFailed(copy.errors.txUnconfirmed)
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new WriteFailed(copy.errors.txReverted)
}
