import { readdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'

/**
 * The small slice of Postgres the internal service uses. The production client and the
 * in-memory test database both implement it, so the same code runs against either.
 */
export interface Db {
  /** Runs one statement with bound parameters and returns its rows. */
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>
  /** Runs one or more statements that carry no parameters, for DDL. */
  exec(text: string): Promise<void>
  /** Runs `fn` inside a transaction. The work is rolled back when `fn` throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

interface MigrationFile {
  name: string
  sql: string
}

async function readMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort()
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(new URL(name, MIGRATIONS_DIR), 'utf8') })),
  )
}

/**
 * The advisory lock every process that runs the migrations takes. The service and the indexer
 * both run them against the same database, so they have to take turns.
 */
const MIGRATION_LOCK = [1296387401, 1094861636] as const

/** The table that records which migrations have run. It is created under the lock. */
const CREATE_MIGRATION_TABLE =
  'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'

/**
 * Runs every migration that has not run yet and returns their names. Running it again does
 * nothing, so the indexer and the service can both call it on every start.
 */
export async function migrate(db: Db): Promise<string[]> {
  const files = await readMigrationFiles()
  const fresh: string[] = []
  for (const file of files) {
    if (await migrateOne(db, file)) fresh.push(file.name)
  }
  return fresh
}

/**
 * Runs one migration in its own transaction, behind the advisory lock.
 *
 * The lock is held until the transaction ends, so two processes never run the same migration at
 * the same time. The bookkeeping table is created inside the lock as well: `CREATE TABLE IF NOT
 * EXISTS` is not safe against another process creating the same table at the same moment, and
 * the first start of a new database is exactly that moment.
 */
async function migrateOne(db: Db, file: MigrationFile): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [...MIGRATION_LOCK])
    await tx.exec(CREATE_MIGRATION_TABLE)
    const applied = await tx.query<{ name: string }>('SELECT name FROM schema_migrations WHERE name = $1', [file.name])
    if (applied.length > 0) return false
    await tx.exec(file.sql)
    await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file.name])
    return true
  })
}

/**
 * The longest rate window a caller may ask for. A rate row carries no window length of its own,
 * because the caller decides it, so this is also how long a row may live.
 */
export const RATE_MAX_WINDOW_SECONDS = 3600

/**
 * Deletes the rows that are only useful while they are fresh.
 *
 * A rate row carries no window length of its own, because the caller decides it, so the caller
 * also says how long a row may live at most.
 */
export async function cleanup(
  db: Db,
  now: Date,
  maxWindowSeconds = RATE_MAX_WINDOW_SECONDS,
): Promise<{ nonces: number; rate: number }> {
  const expired = await db.query('DELETE FROM nonces WHERE expires_at <= $1 RETURNING address', [now.toISOString()])
  const oldestWindow = Math.floor(now.getTime() / 1000) - maxWindowSeconds
  const old = await db.query('DELETE FROM rate WHERE window_start <= $1 RETURNING key', [oldestWindow])
  return { nonces: expired.length, rate: old.length }
}

/**
 * The part of a postgres.js client the service uses.
 *
 * postgres.js picks the simple protocol when a statement carries no parameters, and the simple
 * protocol can run several statements at once. `query` runs one statement, so it forces the
 * extended protocol, where every value is bound. `exec` keeps the simple one, which is what DDL
 * needs.
 */
type SqlRunner = postgres.ISql<{}>

const EXTENDED = { simple: false } as postgres.UnsafeQueryOptions

function runner(client: SqlRunner): Pick<Db, 'query' | 'exec'> {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const rows = await client.unsafe<unknown[]>(text, (params ?? []) as postgres.ParameterOrJSON<never>[], EXTENDED)
      return rows as T[]
    },
    async exec(text: string): Promise<void> {
      await client.unsafe(text)
    },
  }
}

const noNestedTransaction = async (): Promise<never> => {
  throw new Error('a transaction cannot start inside a transaction')
}

/** Wraps a postgres.js client in the `Db` interface. */
export function postgresDb(client: postgres.Sql): Db {
  return {
    ...runner(client),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return client.begin(async (tx) => fn({ ...runner(tx), transaction: noNestedTransaction })) as Promise<T>
    },
  }
}

/** Opens the production database. The caller closes it when the service stops. */
export function createPostgresDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    // A table that already exists is a notice, not a problem, and it would print on every start.
    onnotice: (notice) => {
      if (notice.code !== '42P07') console.warn(notice)
    },
  })
  return { db: postgresDb(client), close: () => client.end({ timeout: 5 }) }
}
