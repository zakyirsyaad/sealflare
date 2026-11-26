import { serve } from '@hono/node-server'
import { createGitHubFetcher } from '@sealflare/scanner-core/adapters'
import { createApp } from './app'
import { cleanup, createPostgresDb, migrate } from './db'
import { parseEnv, sandboxConfig } from './env'
import { createChainReader } from './sandbox/chain'
import { pollOnce, type PollerDeps } from './sandbox/poller'
import { createWorkerClient } from './sandbox/workerClient'

/** How often the expired nonces and the old rate rows are removed. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/** How often the queue looks at the worker. */
const POLL_INTERVAL_MS = 3_000

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

const config = sandboxConfig(env)

const app = createApp({
  sql: db,
  env: { internalKey: env.INTERNAL_KEY },
  log: (line) => console.log(line),
  ...(config === null
    ? {}
    : {
        sandbox: {
          sql: db,
          now: () => new Date(),
          chain: createChainReader({
            rpcUrls: config.rpcUrls,
            chainId: config.chainId,
            coreAddress: config.coreAddress,
          }),
          skills: {
            fetcher: createGitHubFetcher(config.githubToken === undefined ? {} : { token: config.githubToken }),
            ...(config.githubToken === undefined ? {} : { token: config.githubToken }),
          },
          probeSetVersion: config.probeSetVersion,
          modelId: config.modelId,
        },
      }),
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`internal service on port ${info.port}`))

const timer = setInterval(() => {
  cleanup(db, new Date()).catch((error: unknown) => console.error('cleanup failed', error))
}, CLEANUP_INTERVAL_MS)
timer.unref()

/** The queue of the sandbox, when the service was set up for it. */
const poller: PollerDeps | null =
  config === null
    ? null
    : {
        sql: db,
        now: () => new Date(),
        probeSetVersion: config.probeSetVersion,
        modelId: config.modelId,
        worker: createWorkerClient({ url: config.workerUrl, key: config.workerKey }),
      }

if (poller === null) {
  console.warn('the sandbox is not configured, so the sandbox routes are not mounted')
} else {
  const queueTimer = setInterval(() => {
    pollOnce(poller).catch((error: unknown) => console.error('the sandbox queue failed', error))
  }, POLL_INTERVAL_MS)
  queueTimer.unref()
}

const stop = async (): Promise<void> => {
  clearInterval(timer)
  server.close()
  await close()
  process.exit(0)
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
