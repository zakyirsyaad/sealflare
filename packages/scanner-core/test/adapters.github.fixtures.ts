import { vi } from 'vitest'

export const COMMIT = 'a'.repeat(40), TREE = 'b'.repeat(40)
export const ref = { owner: 'acme', repo: 'skills' }
export const pinned = { ...ref, commit: COMMIT, path: 'swap' }
export const entry = (path: string, mode = '100644', content = '# skill', index = 1) => ({
  path, mode, type: mode === '160000' ? 'commit' : 'blob', sha: index.toString(16).padStart(40, '0'),
  size: Buffer.byteLength(content), content,
})

export function githubFixture(entries = [entry('swap/SKILL.md')],
  options: { truncated?: boolean; truncatedSubtree?: boolean; private?: boolean } = {},
) {
  const directories = new Map<string, string>([['', TREE]])
  for (const { path } of entries) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      if (!directories.has(folder)) directories.set(folder, directories.size.toString(16).padStart(40, 'e'))
    }
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    let body: unknown
    if (url.pathname === '/repos/acme/skills') body = { private: options.private ?? false, default_branch: 'main' }
    else if (url.pathname === '/repos/acme/skills/commits/main' || url.pathname === `/repos/acme/skills/commits/${COMMIT}`) {
      body = { sha: COMMIT, commit: { tree: { sha: TREE } } }
    } else if (url.pathname.includes('/git/trees/')) {
      const sha = url.pathname.split('/').at(-1)!, folder = [...directories].find(([, value]) => value === sha)?.[0]
      if (folder === undefined) throw Error(`Unexpected tree ${url}`)
      const prefix = folder ? `${folder}/` : '', recursive = url.searchParams.has('recursive')
      const files = entries.filter(({ path }) => path.startsWith(prefix)).map(({ content: _content, ...value }) => ({
        ...value, path: value.path.slice(prefix.length),
      })).filter(({ path }) => recursive || !path.includes('/'))
      const dirs = [...directories].filter(([path]) => path !== folder && path.startsWith(prefix))
        .map(([path, sha]) => ({ path: path.slice(prefix.length), sha, type: 'tree', mode: '040000' }))
        .filter(({ path }) => recursive || !path.includes('/'))
      body = { sha, truncated: recursive && (folder ? options.truncatedSubtree ?? false : options.truncated ?? false),
        tree: [...files, ...dirs] }
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
