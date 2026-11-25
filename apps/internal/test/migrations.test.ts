import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import { migrate } from '../src/db'
import { createTestDb, pgliteDb } from './helpers'

const EXPECTED_TABLES = [
  'cursor',
  'events',
  'targets',
  'attestations',
  'guardians',
  'score_changes',
  'challenges',
  'jurors',
  'bonds',
  'bounties',
  'bounty_fillers',
  'balances',
  'scan_cache',
  'rate',
  'nonces',
  'sandbox_runs',
  'sandbox_cache',
  'sandbox_quota',
]

test('the migrations are applied exactly once when two processes start together', async () => {
  // PGlite is one connection, so it serialises the transactions by itself and this test cannot
  // tell the advisory lock apart from that. The lock was checked by hand against a real
  // Postgres, where two processes on an empty database applied each file once and neither
  // crashed.
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)

  const results = await Promise.all([migrate(db), migrate(db)])
  const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')

  // Which call wins is not fixed, so the test asks for the invariant instead.
  expect(results.flat().sort()).toEqual(['001_indexer.sql', '002_operational.sql'])
  expect(rows.map((row) => row.name)).toEqual(['001_indexer.sql', '002_operational.sql'])
  await client.close()
})

test('migrations run from empty and are a no-op the second time', async () => {
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)

  expect(await migrate(db)).toEqual(['001_indexer.sql', '002_operational.sql'])
  expect(await migrate(db)).toEqual([])

  await client.close()
})

test('every table the indexer and the service need exists', async () => {
  const { db, close } = await createTestDb()
  const rows = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  )
  const present = rows.map((row) => row.table_name)
  for (const name of EXPECTED_TABLES) expect(present).toContain(name)
  await close()
})

test('events are unique on (tx_hash, log_index)', async () => {
  const { db, close } = await createTestDb()
  const insert = () =>
    db.query(
      `INSERT INTO events (tx_hash, log_index, block_number, block_hash, contract, name, args)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['0xabc', 0, 1, '0xdef', '0x111', 'TargetCreated', '{}'],
    )

  await insert()
  await expect(insert()).rejects.toThrow()

  const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM events')
  expect(rows[0]?.count).toBe(1)
  await close()
})

test('a migration that fails is not recorded, so it can run again', async () => {
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)

  await expect(
    db.transaction(async (tx) => {
      await tx.exec('CREATE TABLE broken (id integer PRIMARY KEY, id text)')
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', ['broken.sql'])
    }),
  ).rejects.toThrow()

  const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations')
  expect(rows).toEqual([])
  await client.close()
})

test('the tables the indexer fills keep their columns', async () => {
  const { db, close } = await createTestDb()
  const columnsOf = async (table: string): Promise<string[]> => {
    const rows = await db.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      ['public', table],
    )
    return rows.map((row) => row.column_name)
  }

  expect(await columnsOf('cursor')).toEqual(['id', 'last_block', 'last_block_hash'])
  expect(await columnsOf('events')).toEqual([
    'tx_hash',
    'log_index',
    'block_number',
    'block_hash',
    'contract',
    'name',
    'args',
  ])
  expect(await columnsOf('scan_cache')).toEqual(['target_id', 'src', 'report', 'scanned_at'])
  expect(await columnsOf('rate')).toEqual(['key', 'window_start', 'count'])
  expect(await columnsOf('nonces')).toEqual(['address', 'nonce', 'expires_at', 'state'])
  await close()
})

test('query runs one statement, so a second statement cannot hide in it', async () => {
  const { db, close } = await createTestDb()

  await expect(db.query('SELECT 1 AS n; DELETE FROM events')).rejects.toThrow()
  await close()
})

test('a value outside the read model is refused by the database itself', async () => {
  const { db, close } = await createTestDb()
  const target = (targetType: string) =>
    db.query('INSERT INTO targets (target_id, target_type, label, created_at_block) VALUES ($1, $2, $3, $4)', [
      `0x${'1'.repeat(64)}`,
      targetType,
      'A target',
      1,
    ])

  await target('SMART_CONTRACT')
  await expect(target('SOMETHING_ELSE')).rejects.toThrow()
  await close()
})

test('a verdict outside the read model is refused by the database itself', async () => {
  const { db, close } = await createTestDb()
  await db.query('INSERT INTO targets (target_id, target_type, label, created_at_block) VALUES ($1, $2, $3, $4)', [
    `0x${'1'.repeat(64)}`,
    'SMART_CONTRACT',
    'A target',
    1,
  ])

  const attest = (verdict: string) =>
    db.query(
      `INSERT INTO attestations (tx_hash, log_index, target_id, guardian, verdict, flags, weight, attestation_index, safe_ordinal, short_proof, evidence_uri, at)
       VALUES ($1, $2, $3, $4, $5, 0, 1, 0, 0, '', '', now())`,
      ['0xabc', 0, `0x${'1'.repeat(64)}`, '0x2', verdict],
    )

  await attest('SAFE')
  await expect(attest('MAYBE')).rejects.toThrow()
  await close()
})
