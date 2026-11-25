import { afterEach, expect, test, vi } from 'vitest'
import { createGitHubFetcher } from '../src/adapters/github'
import { COMMIT, TREE, ref, pinned, entry, githubFixture } from './adapters.github.fixtures'

afterEach(() => vi.useRealTimers())

test('a small skill subtree can be fetched even when the whole repository would be truncated', async () => {
  const base = githubFixture(undefined, { truncated: true })
  const repo = createGitHubFetcher({ fetch: base })
  expect((await repo.fetchBundle(pinned)).map(({ path }) => path)).toEqual(['SKILL.md'])
  expect(base.mock.calls.some(([url]) => String(url).endsWith(`/trees/${TREE}?recursive=1`))).toBe(false)
})

test('walks nested directories by pinned tree SHA and returns paths relative to the chosen folder', async () => {
  const base = githubFixture([entry('skills/swap/SKILL.md'), entry('skills/swap/scripts/run.js', '100755', 'console.log(1)', 2)])
  expect((await createGitHubFetcher({ fetch: base }).fetchBundle({ ...pinned, path: 'skills/swap' })).map(({ path }) => path))
    .toEqual(['SKILL.md', 'scripts/run.js'])
})

test('a truncated selected subtree is rejected, not scanned partially', async () => {
  const base = githubFixture(undefined, { truncatedSubtree: true })
  await expect(createGitHubFetcher({ fetch: base }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'BUNDLE_TOO_LARGE' })
})

test('a symlink used as a folder is never followed', async () => {
  const base = githubFixture([entry('swap', '120000', '../../outside')])
  await expect(createGitHubFetcher({ fetch: base }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
  expect(base.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
})

test('blob downloads run with bounded concurrency while preserving bundle order', async () => {
  const entries = [entry('swap/SKILL.md'), ...Array.from({ length: 11 }, (_, i) => entry(`swap/${i}.js`, '100644', `file ${i}`, i + 2))]
  const base = githubFixture(entries)
  let active = 0, peak = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (!String(url).includes('/blobs/')) return base(url, init)
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    try { return await base(url, init) } finally { active-- }
  }
  const bundle = await createGitHubFetcher({ fetch: fetcher, maxConcurrency: 3 }).fetchBundle(pinned)
  expect(peak).toBe(3)
  expect(bundle.map(({ path }) => path)).toEqual(['SKILL.md', ...Array.from({ length: 11 }, (_, i) => `${i}.js`)])
})

test('large anonymous bundles require a token before downloading any blob', async () => {
  const entries = [entry('swap/SKILL.md'), ...Array.from({ length: 40 }, (_, i) => entry(`swap/${i}.js`, '100644', '', i + 2))]
  const base = githubFixture(entries)
  await expect(createGitHubFetcher({ fetch: base }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  expect(base.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
  expect(await createGitHubFetcher({ fetch: githubFixture(entries), token: 'fixture-only' }).fetchBundle(pinned)).toHaveLength(41)
})

test('a known exhausted remaining quota is detected before downloading a partial bundle', async () => {
  const base = githubFixture([entry('swap/SKILL.md'), entry('swap/helper.js', '100644', '', 2)])
  const fetcher: typeof fetch = async (url, init) => {
    const response = await base(url, init)
    response.headers.set('x-ratelimit-remaining', '1')
    return response
  }
  await expect(createGitHubFetcher({ fetch: fetcher, token: 'fixture-only' }).fetchBundle(pinned))
    .rejects.toMatchObject({ code: 'RATE_LIMITED' })
  expect(base.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
})

test('the overall operation deadline cancels in-flight downloads and returns no partial bundle', async () => {
  vi.useFakeTimers()
  const base = githubFixture(), signals: AbortSignal[] = []
  const fetcher: typeof fetch = async (url, init) => {
    if (!String(url).includes('/blobs/')) return base(url, init)
    if (init?.signal) signals.push(init.signal)
    return new Promise(() => {})
  }
  let settled = false
  const promise = createGitHubFetcher({ fetch: fetcher, timeoutMs: 20 }).fetchBundle(pinned)
  const result = promise.catch((error: unknown) => { settled = true; return error })
  try {
    await vi.advanceTimersByTimeAsync(21)
    expect(settled).toBe(true)
    expect(await result).toMatchObject({ code: 'NO_SKILL_FOUND' })
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
  } finally { await vi.runOnlyPendingTimersAsync() }
})

test('same-origin API redirects support renamed repositories without sending credentials elsewhere', async () => {
  const base = githubFixture(), requests: { url: string; authorization: string | null; redirect?: RequestInit['redirect'] }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization'), redirect: init?.redirect })
    if (url === 'https://api.github.com/repos/acme/old') {
      return new Response('', { status: 301, headers: { location: 'https://api.github.com/repos/acme/skills' } })
    }
    return base(url.replace('/acme/old/', '/acme/skills/'), init)
  }
  expect(await createGitHubFetcher({ token: 'fixture-only', fetch: fetcher }).listSkillFolders({ ...ref, repo: 'old' }))
    .toEqual({ commit: COMMIT, folders: ['swap'] })
  expect(requests[0]?.redirect).toBe('manual')
  expect(requests.some(({ url }) => url === 'https://api.github.com/repos/acme/skills')).toBe(true)
  expect(requests.every(({ authorization }) => authorization === 'Bearer fixture-only')).toBe(true)
})

test.each(['https://evil.example/steal', 'http://api.github.com/steal', 'https://user:pass@api.github.com/steal'])
  ('unsafe redirect %s is refused before another request', async (location) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 301, headers: { location } }))
    await expect(createGitHubFetcher({ token: 'fixture-only', fetch: fetcher }).listSkillFolders(ref)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

test('redirect loops stop at a bounded hop count', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 301,
    headers: { location: 'https://api.github.com/repos/acme/skills' } }))
  await expect(createGitHubFetcher({ fetch: fetcher }).listSkillFolders(ref)).rejects.toThrow()
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4)
})

test('a failed concurrent download cancels its siblings and never schedules the remaining files', async () => {
  const entries = [entry('swap/SKILL.md'), ...Array.from({ length: 9 }, (_, i) => entry(`swap/${i}.js`, '100644', '', i + 2))]
  const base = githubFixture(entries), signals: AbortSignal[] = []
  const fetcher: typeof fetch = async (url, init) => {
    if (!String(url).includes('/blobs/')) return base(url, init)
    signals.push(init!.signal!)
    if (signals.length === 1) return new Response('', { status: 500 })
    return new Promise(() => {})
  }
  await expect(createGitHubFetcher({ fetch: fetcher, maxConcurrency: 3 }).fetchBundle(pinned))
    .rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
  expect(signals).toHaveLength(3)
  expect(signals.every(({ aborted }) => aborted)).toBe(true)
})

test('the maximum 200-file bundle fits the overall deadline with bounded downloads and a token', async () => {
  vi.useFakeTimers()
  const entries = [entry('swap/SKILL.md'), ...Array.from({ length: 199 }, (_, i) => entry(`swap/${i}.js`, '100644', '', i + 2))]
  const base = githubFixture(entries)
  let active = 0, peak = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (!String(url).includes('/blobs/')) return base(url, init)
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 100))
    try { return await base(url, init) } finally { active-- }
  }
  const result = createGitHubFetcher({ fetch: fetcher, token: 'fixture-only' }).fetchBundle(pinned)
  await vi.advanceTimersByTimeAsync(6000)
  expect(await result).toHaveLength(200)
  expect(peak).toBe(4)
})

test('relative same-origin redirects are followed within the same deadline', async () => {
  const base = githubFixture()
  const fetcher: typeof fetch = async (input, init) => String(input) === 'https://api.github.com/repos/acme/old'
    ? new Response('', { status: 308, headers: { location: '/repos/acme/skills' } })
    : base(String(input).replace('/acme/old/', '/acme/skills/'), init)
  expect(await createGitHubFetcher({ fetch: fetcher }).listSkillFolders({ ...ref, repo: 'old' }))
    .toEqual({ commit: COMMIT, folders: ['swap'] })
})
