import { serve } from '@hono/node-server'
import { createGitHubFetcher } from '@sealflare/scanner-core/adapters'
import { createApp } from './app'
import { cleanup, createPostgresDb, migrate } from './db'
import { parseEnv, sandboxConfig } from './env'
import { createChainReader } from './sandbox/chain'
import { runQueue, type PollerDeps } from './sandbox/poller'
import { createWorkerClient } from './sandbox/workerClient'
import { waitForQueue } from './shutdown'

/** How often the expired nonces and the old rate rows are removed. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/** Whether the service is on its way down. The queue stops after the pass it is in. */
let stopping = false

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
            fetcher: createGitHubFetcher({ token: config.githubToken }),
            token: config.githubToken,
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

/** The promise of the queue, so the service can wait for the pass that is in flight. */
let queue: Promise<void> | null = null

if (poller === null) {
  console.warn('the sandbox is not configured, so the sandbox routes are not mounted')
} else {
  // The queue waits for every pass before it starts the next one, so two passes never read the
  // same run at the same time. The promise is kept, so the service can wait for the pass that is
  // in flight before it closes the pool of the database.
  queue = runQueue(poller, {
    isStopped: () => stopping,
    onError: (error: unknown) => console.error('the sandbox queue failed', error),
  })
  // A queue that fails outside of a pass is reported and does not take the service down.
  queue.catch((error: unknown) => console.error('the sandbox queue failed', error))
}

const stop = async (): Promise<void> => {
  stopping = true
  clearInterval(timer)
  server.close()
  // The pass of the queue that is in flight is waited for, so a run that is being refunded is not
  // cut off in the middle.
  await waitForQueue(queue)
  await close()
  process.exit(0)
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
