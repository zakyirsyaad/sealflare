import { serve } from '@hono/node-server'
import { createApp } from './app'
import { cleanup, createPostgresDb, migrate } from './db'
import { parseEnv } from './env'

/** How often the expired nonces and the old rate rows are removed. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

const env = parseEnv(process.env)
const { db, close } = createPostgresDb(env.DATABASE_URL)

try {
  const applied = await migrate(db)
  if (applied.length > 0) console.log(`applied migrations: ${applied.join(', ')}`)
} catch (error) {
  // A database that cannot be migrated is not served, because the service would read a schema
  // it does not know.
  console.error('the internal service cannot start', error)
  await close()
  process.exit(1)
}

const app = createApp({
  sql: db,
  env: { internalKey: env.INTERNAL_KEY },
  log: (line) => console.log(line),
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`internal service on port ${info.port}`))

const timer = setInterval(() => {
  cleanup(db, new Date()).catch((error: unknown) => console.error('cleanup failed', error))
}, CLEANUP_INTERVAL_MS)
timer.unref()

const stop = async (): Promise<void> => {
  clearInterval(timer)
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
