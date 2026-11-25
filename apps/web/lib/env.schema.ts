import { z } from 'zod'

const httpUrl = z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL')
const required = z.string().trim().min(1)
const publicSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().pipe(z.union([z.literal(56), z.literal(31337)])).default(56),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: required.optional(),
  NEXT_PUBLIC_MODULES_LIVE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  NEXT_PUBLIC_AGENT_ID_URL: z.preprocess(value => (value === '' ? undefined : value), httpUrl.optional()),
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
