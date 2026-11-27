import { createPublicClient, defineChain, http } from 'viem'
import { createPostgresDb, migrate } from '@sealflare/internal/db'
import { assertChainId, ChainMismatchError } from './chain'
import { parseEnv } from './env'
import { FatalIndexError } from './fatal'
import { indexOnce } from './loop'

const env = parseEnv(process.env)
const { db, close } = createPostgresDb(env.DATABASE_URL)

await migrate(db)

const chain = defineChain({
  id: env.CHAIN_ID,
  name: 'bnb',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
})
const client = createPublicClient({ chain, transport: http(env.RPC_URL) })
const addresses = { core: env.CORE_ADDRESS, court: env.COURT_ADDRESS, vault: env.VAULT_ADDRESS }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const stop = async (): Promise<void> => {
  await close()
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())

let chainChecked = false

for (;;) {
  try {
    // Checked once, inside the loop, so an RPC node that is down at boot is retried like any other.
    if (!chainChecked) {
      await assertChainId(client, env.CHAIN_ID)
      chainChecked = true
    }
    const result = await indexOnce({
      client,
      sql: db,
      addresses,
      batch: env.BATCH_SIZE,
      startBlock: env.START_BLOCK,
      blockTag: env.BLOCK_TAG,
    })
    if (result.from > result.to) await sleep(env.POLL_INTERVAL_MS)
  } catch (error) {
    // The wrong chain is not a passing problem: reading again fails the same way. Stop with a
    // non-zero exit so the restart policy or the alert of whoever runs the indexer fires. The same
    // holds for an event that names a row the database does not have: that range would be read
    // again and again and would never be written.
    if (error instanceof ChainMismatchError || error instanceof FatalIndexError) {
      console.error(`the indexer stops: ${error.message}`)
      await close()
      process.exit(1)
    }
    // A chain that is briefly unreachable, or a range that failed to write, must not stop the
    // indexer. It reads the same range again.
    console.error('the indexer could not read a range', error)
    await sleep(env.POLL_INTERVAL_MS)
  }
}
