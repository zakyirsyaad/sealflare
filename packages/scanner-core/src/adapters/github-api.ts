// API checked 2026-11-25:
// https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
import { ScanError } from '@sealflare/shared/schemas'
import { requestJson, ResponseTooLarge } from './http'

export type GitHubOptions = { token?: string; fetch?: typeof fetch; maxConcurrency?: number; timeoutMs?: number }
export type Get = (path: string, limit?: number) => Promise<unknown>
export const tooLarge = () => new ScanError('BUNDLE_TOO_LARGE', 'This skill is too large to scan.')

function retryAfter(headers: Headers): number {
  const value = headers.get('retry-after')
  if (value && /^\d+$/.test(value)) return Math.max(1, Number(value))
  const date = value ? Date.parse(value) : NaN
  const reset = Number(headers.get('x-ratelimit-reset')) * 1000
  return Math.max(1, Math.ceil(((Number.isFinite(date) ? date : reset || Date.now() + 60_000) - Date.now()) / 1000))
}

function rateLimited(headers: Headers, message = 'GitHub rate limit reached.') {
  return new ScanError('RATE_LIMITED', message, { retryAfterSeconds: retryAfter(headers) })
}

function rejectStatus(status: number, headers: Headers, repoLookup: boolean): void {
  if (status === 429 || status === 403) throw rateLimited(headers)
  if (status === 404 && repoLookup) throw new ScanError('REPO_NOT_PUBLIC', 'This repository is not public.')
  if (status !== 200) throw new ScanError('NO_SKILL_FOUND', 'GitHub could not return the requested repository data.')
}

function createApi(options: GitHubOptions, signal: AbortSignal) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }
  let remaining = Infinity, quotaHeaders = new Headers()
  const get: Get = async (path, limit = 8_388_608) => {
    try {
      signal.throwIfAborted()
      if (remaining < 1) throw rateLimited(quotaHeaders)
      remaining--
      const response = await requestJson(options.fetch ?? fetch, `https://api.github.com${path}`,
        { headers, signal }, limit, 5000, true)
      quotaHeaders = response.headers
      const quota = response.headers.get('x-ratelimit-remaining')
      if (quota !== null && /^\d+$/.test(quota)) remaining = Math.min(remaining, Number(quota))
      rejectStatus(response.status, response.headers, /^\/repos\/[^/]+\/[^/]+$/.test(path))
      return response.body
    } catch (error) {
      if (error instanceof ScanError) throw error
      if (error instanceof ResponseTooLarge) throw tooLarge()
      throw new ScanError('NO_SKILL_FOUND', 'GitHub could not return the requested repository data.')
    }
  }
  const checkBlobBudget = (count: number) => {
    if (!options.token && count > 40) throw rateLimited(quotaHeaders, 'A GitHub token is required to download more than 40 skill files.')
    if (count > remaining) throw rateLimited(quotaHeaders)
  }
  return { get, checkBlobBudget }
}

export async function withGitHubApi<T>(options: GitHubOptions,
  work: (api: ReturnType<typeof createApi>, controller: AbortController) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try { return await work(createApi(options, controller.signal), controller) }
  finally { clearTimeout(timer); controller.abort() }
}
