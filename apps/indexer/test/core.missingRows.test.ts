import { expect, test } from 'vitest'
import type { Address, Hex } from 'viem'
import { applyCoreEvent } from '../src/handlers/core'
import type { TimedEvent } from '../src/decode'
import { FatalIndexError } from '../src/fatal'
import { account, createTestDb, targetAddress } from './helpers'

const TARGET_ID = `0x${'12'.repeat(32)}` as Hex
const UNKNOWN = targetAddress(0x71)

function base(name: TimedEvent['name']) {
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

/** The target is in the database, so the event fails on the row it names and not on the target. */
async function dbWithTarget(): Promise<{ db: Awaited<ReturnType<typeof createTestDb>>['db']; close: () => Promise<void> }> {
  const { db, close } = await createTestDb()
  await db.query(
    `INSERT INTO targets (target_id, target_type, label, created_at_block) VALUES ($1, 'SMART_CONTRACT', $2, 1)`,
    [TARGET_ID, UNKNOWN],
  )
  return { db, close }
}

test('a vote whose guardian the database does not have stops the indexer', async () => {
  const { db, close } = await dbWithTarget()
  const event: TimedEvent = {
    ...base('Attested'),
    name: 'Attested',
    args: {
      targetId: TARGET_ID,
      guardian: account(2).address,
      verdict: 0,
      flags: 0,
      weight: 1,
      index: 0,
      safeOrdinal: 1,
      evidenceHash: `0x${'00'.repeat(32)}` as Hex,
      shortProof: '0x',
      evidenceURI: '',
    },
  }

  await expect(applyCoreEvent(db, event)).rejects.toThrow(FatalIndexError)
  await expect(applyCoreEvent(db, event)).rejects.toThrow(/guardian/)
  await close()
})

test('a settlement whose attestation the database does not have stops the indexer', async () => {
  const { db, close } = await dbWithTarget()
  const event: TimedEvent = {
    ...base('AttestationSettled'),
    name: 'AttestationSettled',
    args: { targetId: TARGET_ID, index: 7, delta: 1 },
  }

  await expect(applyCoreEvent(db, event)).rejects.toThrow(FatalIndexError)
  await expect(applyCoreEvent(db, event)).rejects.toThrow(/attestation/)
  await close()
})
