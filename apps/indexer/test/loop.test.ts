import { expect, test } from 'vitest'
import type { Address, PublicClient } from 'viem'
import type { Db } from '@sealflare/internal/db'
import { addresses, attest, chainClient, createTestDb, currentBlock, depositBond, mine, targetAddress } from './helpers'
import { assertChainId, ChainMismatchError } from '../src/chain'
import { indexOnce } from '../src/loop'

const core = () => addresses().core

test('indexes only up to the finalized block', async () => {
  const number = 0x12
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  // The chain says its last final block is far behind the tip, so nothing may be read.
  const behind = await indexOnce({ client: chainClient(1000), sql: db, addresses: { core: core() } })
  expect(behind.events).toBe(0)
  expect(await db.query('SELECT * FROM events')).toHaveLength(0)

  // With the chain caught up, the same event is read.
  const caught = await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  expect(caught.events).toBeGreaterThan(0)
  expect(await db.query('SELECT * FROM events')).not.toHaveLength(0)
  await close()
})

test('a chain without finality is read up to its tip when the run asks for the tip', async () => {
  const number = 0x18
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  // A local node answers the final block with the genesis block, so a run that asks for the tip
  // is the only one that reads anything at all.
  const tip = await indexOnce({
    client: chainClient(1000),
    sql: db,
    addresses: { core: core() },
    blockTag: 'latest',
  })
  expect(tip.events).toBeGreaterThan(0)
  expect(await db.query('SELECT * FROM events')).not.toHaveLength(0)
  await close()
})

test('running the same range twice inserts nothing new', async () => {
  const number = 0x13
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const before = await db.query('SELECT * FROM attestations')
  const counters = await db.query('SELECT safe_count, danger_count FROM targets')

  // Put the cursor back to the start and read the same range again.
  await db.query('DELETE FROM cursor')
  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  expect(await db.query('SELECT * FROM attestations')).toHaveLength(before.length)
  expect(await db.query('SELECT safe_count, danger_count FROM targets')).toEqual(counters)
  await close()
})

test('a crash between the event insert and the cursor update cannot happen', async () => {
  const number = 0x14
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  await expect(
    indexOnce({ client: chainClient(), sql: crashing(db), addresses: { core: core() } }),
  ).rejects.toThrow('the cursor write failed')

  // The events and the cursor go into one transaction, so neither of them is there.
  expect(await db.query('SELECT * FROM events')).toHaveLength(0)
  expect(await db.query('SELECT * FROM cursor')).toHaveLength(0)
  expect(await db.query('SELECT * FROM attestations')).toHaveLength(0)
  await close()
})

test('the cursor stores the block hash, and a hash mismatch at the cursor stops the indexer', async () => {
  const number = 0x15
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const cursor = await db.query<{ id: string; last_block: string; last_block_hash: string }>(
    'SELECT id, last_block, last_block_hash FROM cursor',
  )
  expect(cursor).toHaveLength(1)
  expect(cursor[0]?.id).toBe(core().toLowerCase())
  expect(cursor[0]?.last_block_hash).toMatch(/^0x[0-9a-f]{64}$/)

  await db.query('UPDATE cursor SET last_block_hash = $1', [`0x${'11'.repeat(32)}`])

  await expect(indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })).rejects.toThrow(
    /no longer has the block/,
  )
  // The error has a class of its own, so the process can tell it apart from a passing RPC error.
  await expect(indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })).rejects.toBeInstanceOf(
    ChainMismatchError,
  )
  await close()
})

test('the first read starts at the start block when there is no cursor', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(0x41) })
  // A block with no event in it, after everything that came before.
  await mine(1)
  const startBlock = BigInt(await currentBlock())

  const result = await indexOnce({
    client: chainClient(),
    sql: db,
    addresses: { core: core() },
    startBlock,
  })

  expect(result.from).toBe(startBlock)
  // The vote of the block before the start block is not read.
  expect(result.events).toBe(0)
  expect(await db.query('SELECT * FROM attestations')).toHaveLength(0)
  await close()
})

test('a cursor wins over the start block', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(0x43) })
  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const cursor = await db.query<{ last_block: string }>('SELECT last_block FROM cursor')
  await mine(1)

  const next = await indexOnce({
    client: chainClient(),
    sql: db,
    addresses: { core: core() },
    startBlock: 1n,
  })

  expect(next.from).toBe(BigInt(cursor[0]?.last_block ?? '0') + 1n)
  await close()
})

test('the indexer refuses an RPC whose chain id is not the configured one', async () => {
  await expect(assertChainId(chainClient(), 56)).rejects.toBeInstanceOf(ChainMismatchError)
  await expect(assertChainId(chainClient(), 56)).rejects.toThrow(/CHAIN_ID is 56.*31337/)
  await expect(assertChainId(chainClient(), 31337)).resolves.toBeUndefined()
})

test('an event from an unknown address is ignored', async () => {
  const number = 0x16
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })
  // The Vault emits an event of its own, on another address.
  await depositBond({ from: 0 })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const events = await db.query<{ name: string; contract: string }>('SELECT name, contract FROM events')
  expect(events.length).toBeGreaterThan(0)
  expect(events.every((row) => row.contract === core().toLowerCase())).toBe(true)
  expect(events.some((row) => row.name === 'BondDeposited')).toBe(false)
  await close()
})

test('an RPC failure leaves the cursor where it was', async () => {
  const number = 0x17
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(number) })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  const before = await db.query('SELECT * FROM cursor')
  // A new block, so the indexer has a range to read and the chain is asked for its logs.
  await mine(1)

  await expect(
    indexOnce({ client: unreachable(chainClient()), sql: db, addresses: { core: core() } }),
  ).rejects.toThrow('the chain is unreachable')

  expect(await db.query('SELECT * FROM cursor')).toEqual(before)
  await close()
})

/** A database whose cursor write fails, so the transaction has to roll back. */
function crashing(db: Db): Db {
  return {
    query: (text, params) =>
      text.includes('INSERT INTO cursor')
        ? Promise.reject(new Error('the cursor write failed'))
        : db.query(text, params),
    exec: (text) => db.exec(text),
    transaction: (fn) => db.transaction((tx) => fn(crashing(tx))),
  }
}

/** A client whose logs cannot be read. */
function unreachable(client: PublicClient): PublicClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'getLogs') return async () => Promise.reject(new Error('the chain is unreachable'))
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
