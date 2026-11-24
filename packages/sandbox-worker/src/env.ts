import { isAbsolute } from 'node:path'
import { z } from 'zod'

const Secret = z.string().min(1).max(4096).regex(/^\S+$/)
const PositiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(Number.MAX_SAFE_INTEGER))
const Environment = z.object({
  WORKER_BEARER_KEY: Secret.min(32).regex(/^[!-~]+$/), ANTHROPIC_API_KEY: Secret, PINATA_JWT: Secret,
  DAILY_LLM_CALLS: PositiveInteger,
  RUN_DIR: z.string().min(1).max(4096).refine((value) => isAbsolute(value) && !value.includes('\0')),
  PORT: PositiveInteger.pipe(z.number().max(65_535)),
})
export type Env = z.infer<typeof Environment>

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = Environment.safeParse(source)
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map(({ path }) => String(path[0])))].sort()
    throw Error(`Invalid worker environment: ${variables.join(', ')}.`)
  }
  return parsed.data
}
