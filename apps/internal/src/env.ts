import { z } from 'zod'

/**
 * The variables the sandbox needs.
 *
 * They are optional, because the service also runs the parts that do not sandbox. The sandbox is
 * only started when every one of them is there, so a service without them never answers a
 * sandbox request with a run it cannot do.
 *
 * The probe set version and the model have no default. The worker refuses a run whose probe set
 * version is not its own, so a guessed value would turn every run into a failure. The operator
 * has to name both, and the service reads them from the same worker the run goes to.
 */
export const SandboxEnv = z.object({
  CHAIN_ID: z.coerce.number().int().min(1).max(999999).default(56),
  CORE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'the Core address is not an address')
    .optional(),
  RPC_URLS: z.string().min(1).optional(),
  WORKER_URL: z.string().url().optional(),
  WORKER_BEARER_KEY: z.string().min(32, 'the worker key needs at least 32 characters').optional(),
  SANDBOX_PROBE_SET_VERSION: z.string().min(1).max(40).optional(),
  SANDBOX_MODEL_ID: z.string().min(1).max(80).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
})

export type SandboxEnv = z.infer<typeof SandboxEnv>

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
  ...SandboxEnv.shape,
})

export type InternalEnv = z.infer<typeof InternalEnv>

/** The sandbox configuration, or null when the service was not set up for it. */
export interface SandboxConfig {
  chainId: number
  coreAddress: `0x${string}`
  rpcUrls: string[]
  workerUrl: string
  workerKey: string
  probeSetVersion: string
  modelId: string
  githubToken?: string
}

/**
 * Reads the sandbox configuration.
 *
 * Every variable has to be there. A sandbox that is half configured would answer requests it
 * cannot carry out, so the service refuses to start it instead.
 */
export function sandboxConfig(env: SandboxEnv): SandboxConfig | null {
  if (
    env.CORE_ADDRESS === undefined ||
    env.RPC_URLS === undefined ||
    env.WORKER_URL === undefined ||
    env.WORKER_BEARER_KEY === undefined ||
    env.SANDBOX_PROBE_SET_VERSION === undefined ||
    env.SANDBOX_MODEL_ID === undefined
  ) {
    return null
  }
  const rpcUrls = env.RPC_URLS.split(',')
    .map(url => url.trim())
    .filter(url => url.length > 0)
  if (rpcUrls.length === 0) return null
  return {
    chainId: env.CHAIN_ID,
    coreAddress: env.CORE_ADDRESS as `0x${string}`,
    rpcUrls,
    workerUrl: env.WORKER_URL,
    workerKey: env.WORKER_BEARER_KEY,
    probeSetVersion: env.SANDBOX_PROBE_SET_VERSION,
    modelId: env.SANDBOX_MODEL_ID,
    ...(env.GITHUB_TOKEN === undefined ? {} : { githubToken: env.GITHUB_TOKEN }),
  }
}

/** Parses the environment and names the variable that is wrong, so the log says what to fix. */
export function parseEnv(source: Record<string, string | undefined>): InternalEnv {
  const parsed = InternalEnv.safeParse(source)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'} (${issue.message})`)
    .join('; ')
  throw new Error(`Invalid environment: ${problems}`)
}
