import { createPublicClient, defineChain, http } from 'viem'
import { createPostgresDb, migrate } from '@sealflare/internal/db'
import { parseEnv } from './env'
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
const addresses = { core: env.CORE_ADDRESS }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const stop = async (): Promise<void> => {
  await close()
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())

for (;;) {
  try {
    const result = await indexOnce({ client, sql: db, addresses, batch: env.BATCH_SIZE })
    if (result.from > result.to) await sleep(env.POLL_INTERVAL_MS)
  } catch (error) {
    // A chain that is briefly unreachable, or a range that failed to write, must not stop the
    // indexer. It reads the same range again.
    console.error('the indexer could not read a range', error)
    await sleep(env.POLL_INTERVAL_MS)
  }
}
