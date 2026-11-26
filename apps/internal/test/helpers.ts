import { PGlite } from '@electric-sql/pglite'
import type { Hono } from 'hono'
import { createApp } from '../src/app'
import { migrate, type Db } from '../src/db'

/**
 * The inter-service key the tests use. It is written as a repetition on purpose: a literal that
 * looks like a real secret trips the secret scan in CI.
 */
export const TEST_KEY = 'test-'.repeat(6)

/** The in-memory Postgres the tests run against. It answers the same queries as the real one. */
type PgliteRunner = Pick<PGlite, 'query' | 'exec'>

function pgliteRunner(client: PgliteRunner): Pick<Db, 'query' | 'exec'> {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await client.query<T>(text, params ? [...params] : undefined)
      return result.rows
    },
    async exec(text: string): Promise<void> {
      await client.exec(text)
    },
  }
}

export function pgliteDb(client: PGlite): Db {
  return {
    ...pgliteRunner(client),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return client.transaction(async (tx) =>
        fn({
          ...pgliteRunner(tx),
          transaction: async () => {
            throw new Error('a transaction cannot start inside a transaction')
          },
        }),
      )
    },
  }
}

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite()
  await client.waitReady
  const db = pgliteDb(client)
  await migrate(db)
  return { db, close: () => client.close() }
}

/** Counts every query that reaches the database, so a test can prove nothing was read. */
export function countingDb(db: Db): { db: Db; calls: () => number } {
  let calls = 0
  return {
    db: {
      query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
        calls += 1
        return db.query<T>(text, params)
      },
      exec(text: string): Promise<void> {
        calls += 1
        return db.exec(text)
      },
      transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
        calls += 1
        return db.transaction(fn)
      },
    },
    calls: () => calls,
  }
}

export function testApp(
  db: Db,
  options: {
    key?: string
    now?: () => Date
    sandboxProbeSetVersion?: string
    sandboxModelId?: string
  } = {},
): { app: Hono; key: string } {
  const key = options.key ?? TEST_KEY
  return {
    app: createApp({
      sql: db,
      env: {
        internalKey: key,
        sandboxProbeSetVersion: options.sandboxProbeSetVersion,
        sandboxModelId: options.sandboxModelId,
      },
      now: options.now,
    }),
    key,
  }
}

export function headers(key: string | null = TEST_KEY): Record<string, string> {
  const base = { 'content-type': 'application/json' }
  return key === null ? base : { ...base, authorization: `Bearer ${key}` }
}

export function post(app: Hono, path: string, body: unknown, key: string | null = TEST_KEY): Promise<Response> {
  return Promise.resolve(app.request(path, { method: 'POST', headers: headers(key), body: JSON.stringify(body) }))
}

export function put(app: Hono, path: string, body: unknown, key: string | null = TEST_KEY): Promise<Response> {
  return Promise.resolve(app.request(path, { method: 'PUT', headers: headers(key), body: JSON.stringify(body) }))
}

export function get(app: Hono, path: string, key: string | null = TEST_KEY): Promise<Response> {
  return Promise.resolve(app.request(path, { headers: headers(key) }))
}

/** Reads the answer body. The shape is checked by the schema of the route, not by the test. */
export async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}
