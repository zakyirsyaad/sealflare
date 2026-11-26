import { expect, test } from 'vitest'
import type { Hex } from 'viem'
import { applyVaultEvent } from '../src/handlers/vault'
import type { TimedVaultEvent } from '../src/decodeVault'
import { FatalIndexError } from '../src/fatal'
import { account, createTestDb } from './helpers'

/**
 * The Vault events that name a dispute.
 *
 * A dispute that the database does not have means that the indexer started too late, and the
 * payout of that dispute would change nothing while the answers keep looking healthy. The
 * indexer stops instead.
 *
 * The stake is the exception: the Court pays it in the same transaction that opens the dispute,
 * and it emits the opening after the Vault has taken the stake. The row of the dispute is
 * written a moment later, in the same range.
 */

function base(name: TimedVaultEvent['name']) {
  return {
    txHash: `0x${'ab'.repeat(32)}` as Hex,
    logIndex: 0,
    blockNumber: 100n,
    blockHash: `0x${'cd'.repeat(32)}` as Hex,
    contract: account(0).address,
    at: new Date('2026-11-25T03:00:00.000Z'),
    name,
  }
}

test('a payout for a dispute the database does not have stops the indexer', async () => {
  const { db, close } = await createTestDb()
  const event: TimedVaultEvent = {
    ...base('Distributed'),
    name: 'Distributed',
    args: { challengeId: 7n, recipient: account(3).address, amount: 100n },
  }

  await expect(applyVaultEvent(db, event)).rejects.toThrow(FatalIndexError)
  await expect(applyVaultEvent(db, event)).rejects.toThrow(/challenge/)
  await close()
})

test('a stake is written before the dispute that paid it is opened', async () => {
  const { db, close } = await createTestDb()
  const event: TimedVaultEvent = {
    ...base('StakeDeposited'),
    name: 'StakeDeposited',
    args: { challengeId: 7n, account: account(2).address, amount: 100n },
  }

  await applyVaultEvent(db, event)

  const rows = await db.query<{ challenge_id: string; delta: string }>(
    'SELECT challenge_id, delta::text AS delta FROM escrow_movements WHERE challenge_id = $1',
    ['7'],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.delta).toBe('100')
  await close()
})
