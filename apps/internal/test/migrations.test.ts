import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import { CONSTANTS } from '@sealflare/shared/rules'
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
  'payouts',
  'escrow_movements',
  'scan_cache',
  'rate',
  'nonces',
  'sandbox_runs',
  'sandbox_cache',
  'sandbox_quota',
  'sandbox_pause',
]

const MIGRATIONS = [
  '001_indexer.sql',
  '002_operational.sql',
  '003_guards.sql',
  '004_court_vault.sql',
  '005_sandbox.sql',
  '006_bounty_before_target.sql',
  '007_verdict_moment.sql',
]

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

/** The hash of every migration file, the same way the runner hashes them. */
async function migrationHashes(): Promise<Map<string, string>> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
  const hashes = new Map<string, string>()
  for (const name of names) {
    const sql = await readFile(new URL(name, MIGRATIONS_DIR), 'utf8')
    hashes.set(name, createHash('sha256').update(sql).digest('hex'))
  }
  return hashes
}

test('a migration that was renamed runs on a database that ran its old name', async () => {
  const { db, close } = await createTestDb()
  // The last two files were renamed, so a database that ran the old names runs these ones as
  // well. Every statement of them has to survive that.
  for (const name of ['006_bounty_before_target.sql', '007_verdict_moment.sql']) {
    const sql = await readFile(new URL(name, MIGRATIONS_DIR), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
  }
  await close()
})

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
  expect(results.flat().sort()).toEqual(MIGRATIONS)
  expect(rows.map((row) => row.name)).toEqual(MIGRATIONS)
  await client.close()
})

test('migrations run from empty and are a no-op the second time', async () => {
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)

  expect(await migrate(db)).toEqual(MIGRATIONS)
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
  expect(await columnsOf('rate')).toEqual(['key', 'window_start', 'count', 'window_seconds'])
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

test('every applied migration is recorded with the hash of its file', async () => {
  const { db, close } = await createTestDb()
  const hashes = await migrationHashes()

  const rows = await db.query<{ name: string; sha256: string }>(
    'SELECT name, sha256 FROM schema_migrations ORDER BY name',
  )
  expect(rows.map((row) => row.name)).toEqual([...hashes.keys()])
  for (const row of rows) expect(row.sha256).toBe(hashes.get(row.name))
  await close()
})

test('a migration file that changed after it ran stops the service', async () => {
  const { db, close } = await createTestDb()
  await db.query('UPDATE schema_migrations SET sha256 = $1 WHERE name = $2', ['f'.repeat(64), '002_operational.sql'])

  await expect(migrate(db)).rejects.toThrow(/002_operational\.sql changed after it ran/)
  await close()
})

test('a record without a hash, from a build that kept none, is filled in', async () => {
  const { db, close } = await createTestDb()
  await db.query('UPDATE schema_migrations SET sha256 = NULL WHERE name = $1', ['002_operational.sql'])

  expect(await migrate(db)).toEqual([])
  const hashes = await migrationHashes()
  const rows = await db.query<{ sha256: string }>('SELECT sha256 FROM schema_migrations WHERE name = $1', [
    '002_operational.sql',
  ])
  expect(rows[0]?.sha256).toBe(hashes.get('002_operational.sql'))
  await close()
})

test('the cached sandbox result carries a status from the closed list', async () => {
  const { db, close } = await createTestDb()
  const insert = (status: string, bundle: string) =>
    db.query(
      `INSERT INTO sandbox_cache (bundle_hash, probe_set_version, model_id, status, result, created_at)
       VALUES ($1, 'v1', 'model', $2, '{}'::jsonb, now())`,
      [bundle, status],
    )

  await insert('SANDBOX_FUZZ_FAILED', `0x${'1'.repeat(64)}`)
  await insert('NO_VIOLATION_OBSERVED', `0x${'2'.repeat(64)}`)
  await expect(insert('MAYBE', `0x${'3'.repeat(64)}`)).rejects.toThrow()
  await close()
})

test('a failed sandbox result is never replaced by a clean one and never removed', async () => {
  const { db, close } = await createTestDb()
  await db.query(
    `INSERT INTO sandbox_cache (bundle_hash, probe_set_version, model_id, status, result, created_at)
     VALUES ($1, 'v1', 'model', 'SANDBOX_FUZZ_FAILED', '{}'::jsonb, now())`,
    [`0x${'1'.repeat(64)}`],
  )

  await expect(
    db.query('UPDATE sandbox_cache SET status = $1 WHERE bundle_hash = $2', [
      'NO_VIOLATION_OBSERVED',
      `0x${'1'.repeat(64)}`,
    ]),
  ).rejects.toThrow()
  await expect(db.query('DELETE FROM sandbox_cache')).rejects.toThrow()
  await close()
})

test('a failed sandbox result is found by the bundle alone', async () => {
  const { db, close } = await createTestDb()
  await db.query(
    `INSERT INTO sandbox_cache (bundle_hash, probe_set_version, model_id, status, result, created_at)
     VALUES ($1, 'v1', 'model', 'SANDBOX_FUZZ_FAILED', '{}'::jsonb, now())`,
    [`0x${'1'.repeat(64)}`],
  )

  const rows = await db.query<{ bundle_hash: string }>(
    "SELECT bundle_hash FROM sandbox_cache WHERE bundle_hash = $1 AND status = 'SANDBOX_FUZZ_FAILED'",
    [`0x${'1'.repeat(64)}`],
  )
  expect(rows).toHaveLength(1)
  await close()
})

test('a run status outside the closed list is refused by the database itself', async () => {
  const { db, close } = await createTestDb()
  const insert = (runId: string, status: string) =>
    db.query(
      `INSERT INTO sandbox_runs (run_id, address, bundle_hash, probe_set_version, model_id, status, created_at)
       VALUES ($1, '0xabc', '0xdef', 'v1', 'model', $2, now())`,
      [runId, status],
    )

  await insert('run-1', 'queued')
  await expect(insert('run-2', 'MOSTLY_DONE')).rejects.toThrow()
  await close()
})

test('a failure cause outside the closed list is refused by the database itself', async () => {
  const { db, close } = await createTestDb()
  const insert = (runId: string, cause: string) =>
    db.query(
      `INSERT INTO sandbox_runs (run_id, address, bundle_hash, probe_set_version, model_id, status, failure_cause, created_at)
       VALUES ($1, '0xabc', '0xdef', 'v1', 'model', 'done', $2, now())`,
      [runId, cause],
    )

  await insert('run-1', 'infrastructure')
  await insert('run-2', 'skill_content')
  await expect(insert('run-3', 'infra')).rejects.toThrow()
  await close()
})

test('the quota of an address never passes the daily limit', async () => {
  const { db, close } = await createTestDb()
  const insert = (address: string, used: number) =>
    db.query('INSERT INTO sandbox_quota (address, day, used) VALUES ($1, current_date, $2)', [address, used])

  await insert('0xabc', 0)
  await insert('0xdef', CONSTANTS.SANDBOX_DAILY_RUNS)
  await expect(insert('0x123', CONSTANTS.SANDBOX_DAILY_RUNS + 1)).rejects.toThrow()
  await expect(insert('0x456', -1)).rejects.toThrow()
  await close()
})

test('a rate row cannot be stored without the length of its window', async () => {
  const { db, close } = await createTestDb()

  await expect(
    db.query('INSERT INTO rate (key, window_start, count) VALUES ($1, 1, 1)', ['a'.repeat(64)]),
  ).rejects.toThrow()
  await close()
})

test('the rate row keeps the length of its window', async () => {
  const { db, close } = await createTestDb()
  await db.query('INSERT INTO rate (key, window_start, window_seconds, count) VALUES ($1, 1, 600, 1)', ['a'.repeat(64)])

  const rows = await db.query<{ window_seconds: number }>('SELECT window_seconds FROM rate')
  expect(rows[0]?.window_seconds).toBe(600)
  await close()
})
