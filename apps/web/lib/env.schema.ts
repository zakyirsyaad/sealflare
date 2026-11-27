import { z } from 'zod'

const httpUrl = z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL')
const required = z.string().trim().min(1)
const publicSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().pipe(z.union([z.literal(56), z.literal(97), z.literal(31337)])).default(56),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: required.optional(),
  NEXT_PUBLIC_MODULES_LIVE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  NEXT_PUBLIC_AGENT_ID_URL: z.preprocess(value => (value === '' ? undefined : value), httpUrl.optional()),
  /**
   * The build is an end-to-end build, so the app offers the wallet of the suite.
   *
   * The flag is inlined at build time, so a deployment without it never carries the wallet.
   */
  NEXT_PUBLIC_E2E: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
})
const serverSchema = z.object({
  INTERNAL_URL: httpUrl,
  INTERNAL_KEY: required,
  RPC_URLS: required.transform(value => value.split(',').map(url => url.trim())).pipe(z.array(httpUrl).min(1)),
  BSCSCAN_KEY: required,
  GITHUB_TOKEN: required,
  PINATA_JWT: required,
  SCANNER: z.enum(['mock', 'real']),
})

function parse<T extends z.ZodType>(schema: T, input: Record<string, string | undefined>): z.output<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map(issue => issue.path.join('.')))]
    throw new Error(`Invalid environment variables: ${names.join(', ')}`)
  }
  return result.data
}
export const parsePublicEnv = (input: Record<string, string | undefined>) => parse(publicSchema, input)
export const parseServerEnv = (input: Record<string, string | undefined>) => parse(serverSchema, input)
// Exactly "mock" or "real". A missing or mistyped value must never pick a scanner by default.
export const parseScannerMode = (input: Record<string, string | undefined>) => parse(serverSchema.pick({ SCANNER: true }), input).SCANNER

/** The door to the internal service and the key that opens it. */
const internalSchema = z.object({ INTERNAL_URL: httpUrl, INTERNAL_KEY: required })
export const parseInternalEnv = (input: Record<string, string | undefined>) => parse(internalSchema, input)

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The JWT goes to this URL as a bearer token, so plain http is only allowed to the machine itself. */
const pinataUrl = httpUrl.refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname)
}, 'Use https, or http only for localhost')

/** The key that lets the API store evidence, and the service that stores it. */
const pinataSchema = z.object({
  PINATA_JWT: required,
  /**
   * The service that stores the evidence.
   *
   * It is the API of Pinata unless a deployment names another one. The end-to-end suite names a
   * local service, so the suite never reaches outside the machine. An empty value is unset.
   */
  PINATA_URL: z.preprocess(
    value => (value === '' ? undefined : value),
    pinataUrl.default('https://api.pinata.cloud/pinning/pinFileToIPFS'),
  ),
})
export const parsePinataEnv = (input: Record<string, string | undefined>): z.output<typeof pinataSchema> =>
  parse(pinataSchema, input)
