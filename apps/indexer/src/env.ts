import { z } from 'zod'
import { AddressSchema } from '@sealflare/shared/schemas'

/**
 * The indexer needs the chain and the database. It holds no key that can move money and it
 * never signs anything.
 */
export const IndexerEnv = z.object({
  DATABASE_URL: z.string().min(1, 'the Postgres connection string is required'),
  RPC_URL: z.string().min(1, 'the chain address is required'),
  CHAIN_ID: z.coerce.number().int().min(1),
  CORE_ADDRESS: AddressSchema,
  BATCH_SIZE: z.coerce.number().int().min(1).max(2000).default(2000),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
})

export type IndexerEnv = z.infer<typeof IndexerEnv>

/** Parses the environment and names the variable that is wrong, so the log says what to fix. */
export function parseEnv(source: Record<string, string | undefined>): IndexerEnv {
  const parsed = IndexerEnv.safeParse(source)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'} (${issue.message})`)
    .join('; ')
  throw new Error(`Invalid environment: ${problems}`)
}
