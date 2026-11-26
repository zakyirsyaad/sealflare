import { expect, test } from 'vitest'
import type { Address } from 'viem'
import type { Db } from '@sealflare/internal/db'
import { addresses, attest, chainClient, createTestDb, targetAddress } from './helpers'
import { indexOnce } from '../src/loop'

const core = () => addresses().core
const FIRST = targetAddress(0x31)
const SECOND = targetAddress(0x32)

const TABLES = ['cursor', 'events', 'targets', 'attestations', 'guardians', 'score_changes']

test('rebuilding from block 0 yields byte-identical tables', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: FIRST, verdict: 0 })
  await attest({ from: 1, contract: FIRST, verdict: 2, flags: 1 })
  await attest({ from: 2, contract: SECOND, verdict: 1 })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const first = await dump(db)

  await empty(db)
  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const second = await dump(db)

  expect(second).toEqual(first)
  await close()
})

/** Reads every table the indexer fills, in a shape two runs can be compared by. */
async function dump(db: Db): Promise<string> {
  const parts: string[] = []
  for (const table of TABLES) {
    const rows = await db.query(`SELECT * FROM ${table}`)
    const sorted = rows.map((row) => JSON.stringify(row)).sort()
    parts.push(`${table} (${sorted.length})\n${sorted.join('\n')}`)
  }
  return parts.join('\n\n')
}

/** Empties every table the indexer fills, so the next run builds them again. */
async function empty(db: Db): Promise<void> {
  await db.exec(`TRUNCATE ${TABLES.join(', ')} CASCADE`)
}
