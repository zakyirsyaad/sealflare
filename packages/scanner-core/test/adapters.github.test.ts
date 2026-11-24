import { expect, test, vi } from 'vitest'
import { createGitHubFetcher } from '../src/adapters/github'
import { COMMIT, TREE, ref, pinned, entry, githubFixture } from './adapters.github.fixtures'

test('discovers skill folders at one resolved default-branch commit', async () => {
  const fetcher = githubFixture([entry('SKILL.md'), entry('swap/SKILL.md', '100644', '# swap', 2),
    entry('swap/scripts/SKILL.md', '100644', '# nested', 3)])
  expect(await createGitHubFetcher({ fetch: fetcher }).listSkillFolders(ref))
    .toEqual({ commit: COMMIT, folders: ['', 'swap', 'swap/scripts'] })
  expect(fetcher.mock.calls.map(([url]) => String(url))).toContain(`https://api.github.com/repos/acme/skills/git/trees/${TREE}?recursive=1`)
})

test('returns raw file bytes and symlink target text without following it', async () => {
  const fetcher = githubFixture([entry('swap/SKILL.md'), entry('swap/link', '120000', '../../outside', 2),
    entry('swapper/ignored.js', '100644', 'other', 3)])
  const bundle = await createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)
  expect(bundle).toEqual([
    { path: 'SKILL.md', kind: 'file', bytes: new TextEncoder().encode('# skill') },
    { path: 'link', kind: 'symlink', bytes: new TextEncoder().encode('../../outside') },
  ])
  const blobRequests = fetcher.mock.calls.filter(([url]) => String(url).includes('/blobs/'))
  expect(blobRequests).toHaveLength(2)
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('outside'))).toBe(false)
})

test('a submodule in the selected bundle is rejected before downloading blobs', async () => {
  const fetcher = githubFixture([entry('swap/SKILL.md'), entry('swap/dependency', '160000', '', 2)])
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toThrow(/submodule/i)
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
})

test('truncated trees fail instead of returning a partial listing', async () => {
  await expect(createGitHubFetcher({ fetch: githubFixture(undefined, { truncated: true }) }).listSkillFolders(ref))
    .rejects.toMatchObject({ code: 'BUNDLE_TOO_LARGE' })
})

test.each(['count', 'bytes'] as const)('exceeding the %s limit is rejected before any blob download', async (limit) => {
  const entries = limit === 'count' ? Array.from({ length: 201 }, (_, i) => entry(`swap/${i}`, '100644', '', i + 1))
    : [{ ...entry('swap/SKILL.md'), size: 2_097_153 }]
  const fetcher = githubFixture(entries)
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'BUNDLE_TOO_LARGE' })
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
})

test.each([404])('repository metadata HTTP %s maps to REPO_NOT_PUBLIC', async (status) => {
  const fetcher: typeof fetch = async () => new Response('', { status })
  await expect(createGitHubFetcher({ fetch: fetcher }).listSkillFolders(ref)).rejects.toMatchObject({ code: 'REPO_NOT_PUBLIC' })
})

test.each([{}, { 'x-ratelimit-remaining': '100' }])('a secondary rate limit 403 without Retry-After is retryable', async (headers) => {
  const fetcher: typeof fetch = async () => new Response('', { status: 403, headers })
  await expect(createGitHubFetcher({ fetch: fetcher }).listSkillFolders(ref)).rejects.toMatchObject({
    code: 'RATE_LIMITED', details: { retryAfterSeconds: 60 },
  })
})

test.each(['/commits/', '/blobs/'])('a missing resource at %s in a known-public repo is not called private', async (part) => {
  const base = githubFixture()
  const fetcher: typeof fetch = async (url, init) => String(url).includes(part) ? new Response('', { status: 404 }) : base(url, init)
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
})

test.each([403, 429])('HTTP %s with Retry-After is RATE_LIMITED', async (status) => {
  const fetcher: typeof fetch = async () => new Response('', { status, headers: { 'retry-after': '60' } })
  await expect(createGitHubFetcher({ fetch: fetcher }).listSkillFolders(ref))
    .rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 60 } })
})

test('a private repo remains refused even if the token can read it', async () => {
  await expect(createGitHubFetcher({ fetch: githubFixture(undefined, { private: true }), token: 'test-secret' }).fetchBundle(pinned))
    .rejects.toMatchObject({ code: 'REPO_NOT_PUBLIC' })
})

test.each(['../x', 'x/../y', '/absolute', 'x\\y', 'x\u0000y'])('path %j is rejected before network access', async (path) => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle({ ...pinned, path })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

test('a pinned commit is never silently changed by GitHub', async () => {
  const base = githubFixture()
  const fetcher: typeof fetch = async (url, init) => String(url).includes('/commits/')
    ? new Response(JSON.stringify({ sha: 'c'.repeat(40), commit: { tree: { sha: TREE } } })) : base(url, init)
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toThrow()
})

test('a downloaded blob whose bytes differ from the tree size is rejected', async () => {
  const base = githubFixture()
  const fetcher: typeof fetch = async (url, init) => String(url).includes('/blobs/')
    ? new Response(JSON.stringify({ sha: '1'.padStart(40, '0'), size: 1, encoding: 'base64', content: 'YQ==' })) : base(url, init)
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toThrow()
})

test('an oversized blob response is rejected during download even when the tree claims it is small', async () => {
  const base = githubFixture()
  const fetcher: typeof fetch = async (url, init) => String(url).includes('/blobs/')
    ? new Response(JSON.stringify({ sha: '1'.padStart(40, '0'), size: 7, encoding: 'base64', content: 'A'.repeat(10000) })) : base(url, init)
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'BUNDLE_TOO_LARGE' })
})

test('publisher.sig must be a regular file, like the frozen bundle rules require', async () => {
  const fetcher = githubFixture([entry('swap/SKILL.md'), entry('swap/publisher.sig', '120000', 'outside', 2)])
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
})

test('a pinned binary blob keeps its exact non-UTF8 bytes', async () => {
  const base = githubFixture([entry('swap/SKILL.md', '100644', 'xx')])
  const fetcher: typeof fetch = async (url, init) => String(url).includes('/blobs/')
    ? new Response(JSON.stringify({ sha: '1'.padStart(40, '0'), size: 2, encoding: 'base64', content: '//4=' })) : base(url, init)
  expect((await createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned))[0]?.bytes).toEqual(Uint8Array.of(255, 254))
})

test('a large valid Base64 blob with GitHub line wrapping stays within the download budget', async () => {
  const content = 'x'.repeat(200_000), base = githubFixture([entry('swap/SKILL.md', '100644', content)])
  const fetcher: typeof fetch = async (url, init) => {
    const response = await base(url, init)
    if (!String(url).includes('/blobs/')) return response
    const body = await response.json() as { sha: string; size: number; encoding: string; content: string }
    return new Response(JSON.stringify({ ...body, content: body.content.match(/.{1,60}/g)!.join('\n') }))
  }
  expect((await createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned))[0]?.bytes.byteLength).toBe(200_000)
})

test.each([
  { mode: '100644', type: 'tree' }, { mode: '040000', type: 'blob' }, { mode: '120000', type: 'tree' },
])('inconsistent tree entry %j rejects the entire bundle', async (value) => {
  const fetcher = githubFixture([entry('swap/SKILL.md'), { ...entry('swap/helper.js', '100644', 'malicious helper', 2), ...value }])
  await expect(createGitHubFetcher({ fetch: fetcher }).fetchBundle(pinned)).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/blobs/'))).toBe(false)
})

test.each([
  entry(`vendor/${'x'.repeat(450)}`), entry('vendor/a\\b'), entry('vendor/legacy', '100664'),
])('an unsupported entry outside the skill folder does not break discovery or scanning', async (outside) => {
  const fetcher = githubFixture([entry('swap/SKILL.md'), { ...outside, sha: 'd'.repeat(40) }])
  const repo = createGitHubFetcher({ fetch: fetcher })
  expect(await repo.listSkillFolders(ref)).toEqual({ commit: COMMIT, folders: ['swap'] })
  expect((await repo.fetchBundle(pinned)).map(({ path }) => path)).toEqual(['SKILL.md'])
})
