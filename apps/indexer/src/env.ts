import { z } from 'zod'
import { AddressSchema } from '@sealflare/shared/schemas'

/** The chain id of the local Anvil chain, where the start block is always the first one. */
const LOCAL_CHAIN_ID = 31337

/** A block number: digits only, so `-1`, `1.5`, `0x10` and an empty value are all refused. */
const BlockNumber = z
  .string()
  .regex(/^\d+$/, 'must be a block number written in digits')
  .transform((value) => BigInt(value))

/**
 * The indexer needs the chain and the database. It holds no key that can move money and it
 * never signs anything.
 */
export const IndexerEnv = z
  .object({
    DATABASE_URL: z.string().min(1, 'the Postgres connection string is required'),
    RPC_URL: z.string().min(1, 'the chain address is required'),
    CHAIN_ID: z.coerce.number().int().min(1),
    CORE_ADDRESS: AddressSchema,
    /** The Court the indexer reads. */
    COURT_ADDRESS: AddressSchema,
    /** The Vault the indexer reads. */
    VAULT_ADDRESS: AddressSchema,
    /** The block Core was deployed in. Required on a public chain, 0 on the local one. */
    START_BLOCK: BlockNumber.optional(),
    BATCH_SIZE: z.coerce.number().int().min(1).max(2000).default(2000),
    POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  })
  .superRefine((env, context) => {
    if (env.START_BLOCK === undefined && env.CHAIN_ID !== LOCAL_CHAIN_ID) {
      context.addIssue({
        code: 'custom',
        path: ['START_BLOCK'],
        message: 'required on a public chain; set it to the block Core was deployed in',
      })
    }
  })
  .transform((env) => ({ ...env, START_BLOCK: env.START_BLOCK ?? 0n }))

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
