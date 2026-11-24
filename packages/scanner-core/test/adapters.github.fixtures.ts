import { vi } from 'vitest'

export const COMMIT = 'a'.repeat(40), TREE = 'b'.repeat(40)
export const ref = { owner: 'acme', repo: 'skills' }
export const pinned = { ...ref, commit: COMMIT, path: 'swap' }
export const entry = (path: string, mode = '100644', content = '# skill', index = 1) => ({
  path, mode, type: mode === '160000' ? 'commit' : 'blob', sha: index.toString(16).padStart(40, '0'),
  size: Buffer.byteLength(content), content,
})

export function githubFixture(entries = [entry('swap/SKILL.md')], options: { truncated?: boolean; private?: boolean } = {}) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    let body: unknown
    if (url.pathname === '/repos/acme/skills') body = { private: options.private ?? false, default_branch: 'main' }
    else if (url.pathname === '/repos/acme/skills/commits/main' || url.pathname === `/repos/acme/skills/commits/${COMMIT}`) {
      body = { sha: COMMIT, commit: { tree: { sha: TREE } } }
    } else if (url.pathname === `/repos/acme/skills/git/trees/${TREE}`) {
      body = { sha: TREE, truncated: options.truncated ?? false, tree: entries.map(({ content: _content, ...value }) => value) }
    } else if (url.pathname.includes('/git/blobs/')) {
      const item = entries.find(({ sha }) => url.pathname.endsWith(`/${sha}`))
      if (!item) throw Error(`Unexpected blob ${url}`)
      body = { sha: item.sha, size: Buffer.byteLength(item.content), encoding: 'base64',
        content: Buffer.from(item.content).toString('base64') }
    } else throw Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify(body))
  })
  return fetcher
}
