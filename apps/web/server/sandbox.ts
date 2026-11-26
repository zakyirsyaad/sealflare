import 'server-only'
import { SandboxResult } from '@sealflare/shared/schemas'
import { internalRead, InternalServiceError } from './internal'

/**
 * The result the cache holds for a bundle.
 *
 * The cache lives in the internal service, the only door to the database. A bundle that was never
 * run has no result, and that is not a failure: the page then offers the button instead. A result
 * that cannot be read is no result either, so the page never claims a clean run it cannot show.
 */
export async function loadCachedSandbox(bundleHash: string | null): Promise<SandboxResult | null> {
  if (bundleHash === null) return null
  try {
    const answer = await internalRead<{ result: unknown }>(`/sandbox/cache/${bundleHash}`)
    const parsed = SandboxResult.safeParse(answer.data.result)
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (error instanceof InternalServiceError && error.code === 'RESULT_NOT_CACHED') return null
    return null
  }
}
