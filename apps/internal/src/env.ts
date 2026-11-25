import { z } from 'zod'

/**
 * The internal service reads Postgres and nothing else. It never holds a key that can move
 * money and it never signs anything.
 */
export const InternalEnv = z.object({
  DATABASE_URL: z.string().min(1, 'the Postgres connection string is required'),
  INTERNAL_KEY: z
    .string()
    .min(32, 'the inter-service key needs at least 32 characters')
    .refine((value) => new Set(value).size >= 16, 'the inter-service key needs at least 16 different characters'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3040),
})

export type InternalEnv = z.infer<typeof InternalEnv>

/** Parses the environment and names the variable that is wrong, so the log says what to fix. */
export function parseEnv(source: Record<string, string | undefined>): InternalEnv {
  const parsed = InternalEnv.safeParse(source)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'} (${issue.message})`)
    .join('; ')
  throw new Error(`Invalid environment: ${problems}`)
}
