import { expect, test } from 'vitest'
import type { Hex } from 'viem'
import { applyCoreEvent } from '../src/handlers/core'
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
 * The stake is the exception. The real Court emits `ChallengeOpened` and `VoteCommitted` before it
 * calls `depositStake`, but `CourtStub`, which these tests run against, calls it first, so the row
 * of the dispute may be written a moment later, in the same range. Requiring the row for a stake
 * would need the stub to emit first, which is a change in `contracts/` for the founder.
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

test('a bounty on a target Core has not recorded yet is stored, and the indexer goes on', async () => {
  const { db, close } = await createTestDb()
  const targetId = `0x${'55'.repeat(32)}` as Hex
  const event: TimedVaultEvent = {
    ...base('BountyCreated'),
    name: 'BountyCreated',
    args: { id: 1n, targetId, requester: account(2).address, slots: 3, amount: 1000n, startIndex: 0 },
  }

  await applyVaultEvent(db, event)

  const rows = await db.query<{ label: string | null; target_id: string }>(
    'SELECT label, target_id FROM bounties WHERE id = $1',
    ['1'],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.target_id).toBe(targetId)
  expect(rows[0]?.label).toBeNull()
  await close()
})

test('the bounty takes the label of its target when the target is created', async () => {
  const { db, close } = await createTestDb()
  const target = '0x2222222222222222222222222222222222222222'
  const targetId = `0x${'66'.repeat(32)}` as Hex
  await applyVaultEvent(db, {
    ...base('BountyCreated'),
    name: 'BountyCreated',
    args: { id: 1n, targetId, requester: account(2).address, slots: 3, amount: 1000n, startIndex: 0 },
  })

  await applyCoreEvent(db, {
    ...base('BountyCreated'),
    name: 'TargetCreated',
    args: { targetId, targetType: 0, target: `0x${'00'.repeat(12)}${target.slice(2)}` as Hex, pinnedCodehash: `0x${'77'.repeat(32)}` as Hex },
  } as never)

  const rows = await db.query<{ label: string | null }>('SELECT label FROM bounties WHERE id = $1', ['1'])
  expect(rows[0]?.label).toBe(target)
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
