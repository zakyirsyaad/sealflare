import { expect, test } from 'vitest'
import type { Hex } from 'viem'
import { applyCoreEvent } from '../src/handlers/core'
import { applyVaultEvent } from '../src/handlers/vault'
import type { TimedEvent } from '../src/decode'
import { account, createTestDb, targetAddress } from './helpers'

/**
 * The bond a target shows is the bond of the publisher of record, so it follows the publisher.
 *
 * The Core lets a verified publisher take over a sponsored target, and `Vault.activeBond` reads
 * the bond of the publisher it has now. The row of the target has to say the same.
 */

const TARGET_ID = `0x${'12'.repeat(32)}` as Hex
const SPONSOR_ROLE = 1
const VERIFIED_ROLE = 2

function base() {
  return {
    txHash: `0x${'ab'.repeat(32)}` as Hex,
    blockNumber: 100n,
    blockHash: `0x${'cd'.repeat(32)}` as Hex,
    contract: account(0).address,
    at: new Date('2026-11-25T03:00:00.000Z'),
  }
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

async function bondOfTarget(db: TestDb): Promise<string> {
  const rows = await db.query<{ bond: unknown }>('SELECT bond FROM targets WHERE target_id = $1', [TARGET_ID])
  return String(rows[0]?.bond)
}

async function withTarget(label: number): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const { db, close } = await createTestDb()
  await db.query(
    `INSERT INTO targets (target_id, target_type, label, created_at_block) VALUES ($1, 'SMART_CONTRACT', $2, 1)`,
    [TARGET_ID, targetAddress(label)],
  )
  return { db, close }
}

function bind(logIndex: number, publisher: Hex, role: number): TimedEvent {
  return {
    ...base(),
    logIndex,
    name: 'PublisherBound',
    args: { targetId: TARGET_ID, publisher: publisher as `0x${string}`, role, method: 0 },
  }
}

test('a verified publisher that takes over a sponsored target does not inherit the bond of the sponsor', async () => {
  const { db, close } = await withTarget(0x71)
  const sponsor = account(1).address
  const owner = account(2).address

  await applyCoreEvent(db, bind(0, sponsor, SPONSOR_ROLE))
  await applyVaultEvent(db, {
    ...base(),
    logIndex: 1,
    name: 'BondDeposited',
    args: { targetId: TARGET_ID, depositor: sponsor, amount: 100n, total: 100n },
  })
  expect(await bondOfTarget(db)).toBe('100')

  await applyCoreEvent(db, bind(2, owner, VERIFIED_ROLE))
  expect(await bondOfTarget(db)).toBe('0')
  await close()
})

test('a publisher that takes the target back sees its own bond again', async () => {
  const { db, close } = await withTarget(0x72)
  const first = account(1).address
  const second = account(2).address

  await applyCoreEvent(db, bind(0, first, VERIFIED_ROLE))
  await applyVaultEvent(db, {
    ...base(),
    logIndex: 1,
    name: 'BondDeposited',
    args: { targetId: TARGET_ID, depositor: first, amount: 50n, total: 50n },
  })
  await applyCoreEvent(db, bind(2, second, VERIFIED_ROLE))
  expect(await bondOfTarget(db)).toBe('0')

  await applyCoreEvent(db, bind(3, first, VERIFIED_ROLE))
  expect(await bondOfTarget(db)).toBe('50')
  await close()
})
