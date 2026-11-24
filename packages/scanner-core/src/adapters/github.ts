// APIs checked 2026-11-25:
// https://docs.github.com/en/rest/git/trees#get-a-tree
// https://docs.github.com/en/rest/git/blobs#get-a-blob
// https://docs.github.com/en/rest/commits/commits#get-a-commit
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { CONSTANTS, EXCLUDED_PATH, MAX_PUBLISHER_SIG_BYTES, contentHash, BundleError, type BundleEntry } from '@sealflare/shared/rules'
import { ScanError, SkillSource, type RepoFetcher, type RepoRef, type SkillRef } from '@sealflare/shared/schemas'
import { requestJson, ResponseTooLarge } from './http'

const Name = z.string().regex(/^[A-Za-z0-9_.-]+$/).refine((value) => value !== '.' && value !== '..')
const Ref = z.object({ owner: Name, repo: Name, commit: SkillSource.shape.commit.optional() })
const Path = SkillSource.shape.path.refine((value) => !value.includes('\0') && value.isWellFormed())
const Sha = z.string().regex(/^[0-9a-f]{40}$/)
const Entry = z.object({ path: Path.refine((value) => value !== ''), sha: Sha,
  mode: z.enum(['100644', '100755', '120000', '040000', '160000']),
  type: z.enum(['blob', 'tree', 'commit']), size: z.number().int().nonnegative().optional(),
}).refine((entry) => entry.mode === '040000' ? entry.type === 'tree'
  : entry.mode === '160000' ? entry.type === 'commit' : entry.type === 'blob' && entry.size !== undefined)
const Tree = z.object({ sha: Sha, truncated: z.boolean(), tree: z.array(Entry) })
type Entry = z.infer<typeof Entry>
const tooLarge = () => new ScanError('BUNDLE_TOO_LARGE', 'This skill is too large to scan.')

function retryAfter(headers: Headers): number {
  const value = headers.get('retry-after')
  if (value && /^\d+$/.test(value)) return Math.max(1, Number(value))
  const date = value ? Date.parse(value) : NaN
  const reset = Number(headers.get('x-ratelimit-reset')) * 1000
  return Math.max(1, Math.ceil(((Number.isFinite(date) ? date : reset || Date.now() + 60_000) - Date.now()) / 1000))
}

function rejectStatus(status: number, headers: Headers): void {
  if (status === 429 || status === 403 && (headers.has('retry-after') || headers.get('x-ratelimit-remaining') === '0')) {
    throw new ScanError('RATE_LIMITED', 'GitHub rate limit reached.', { retryAfterSeconds: retryAfter(headers) })
  }
  if (status === 404 || status === 403) throw new ScanError('REPO_NOT_PUBLIC', 'This repository is not public.')
  if (status !== 200) throw new ScanError('NO_SKILL_FOUND', 'GitHub could not return the requested repository data.')
}

function validateEntries(entries: Entry[], folder: string): Entry[] {
  const prefix = folder ? `${folder}/` : ''
  const selected = entries.filter((entry) => entry.path.startsWith(prefix) || entry.path === folder)
  if (selected.some((entry) => entry.mode === '160000' || entry.type === 'commit')) {
    throw new ScanError('NO_SKILL_FOUND', 'A skill bundle cannot include a submodule.')
  }
  const blobs = selected.filter((entry) => entry.type !== 'tree')
  const normal = blobs.filter((entry) => entry.path.slice(prefix.length) !== EXCLUDED_PATH)
  if (normal.length > CONSTANTS.MAX_BUNDLE_FILES || normal.reduce((sum, entry) => sum + (entry.size ?? Infinity), 0) > CONSTANTS.MAX_BUNDLE_BYTES) throw tooLarge()
  if (blobs.some((entry) => !['100644', '100755', '120000'].includes(entry.mode) || entry.size === undefined)) {
    throw new ScanError('NO_SKILL_FOUND', 'Invalid file in the repository tree.')
  }
  const signature = blobs.find((entry) => entry.path.slice(prefix.length) === EXCLUDED_PATH)
  if (signature?.mode === '120000') throw new ScanError('NO_SKILL_FOUND', 'publisher.sig must be a regular file.')
  if (signature && signature.size! > MAX_PUBLISHER_SIG_BYTES) throw tooLarge()
  if (new Set(blobs.map(({ path }) => path)).size !== blobs.length) throw new ScanError('NO_SKILL_FOUND', 'Duplicate repository path.')
  if (!blobs.some((entry) => entry.path === `${prefix}SKILL.md` && entry.mode !== '120000')) {
    throw new ScanError('NO_SKILL_FOUND', 'No regular SKILL.md was found in this folder.')
  }
  return blobs
}

type Options = { token?: string; fetch?: typeof fetch }
type Get = (path: string, limit?: number) => Promise<unknown>

function createApi(options: Options): Get {
  const fetcher = options.fetch ?? fetch
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10',
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }
  return async (path: string, limit = 8_388_608): Promise<unknown> => {
    try {
      const response = await requestJson(fetcher, `https://api.github.com${path}`, { headers }, limit)
      rejectStatus(response.status, response.headers)
      return response.body
    } catch (error) {
      if (error instanceof ScanError) throw error
      if (error instanceof ResponseTooLarge) throw tooLarge()
      throw new ScanError('NO_SKILL_FOUND', 'GitHub could not return the requested repository data.')
    }
  }
}

async function treeFor(input: RepoRef, get: Get) {
  const ref = Ref.parse(input), path = `/repos/${ref.owner}/${ref.repo}`
  const repo = z.object({ private: z.boolean(), default_branch: z.string().min(1) }).parse(await get(path))
  if (repo.private) throw new ScanError('REPO_NOT_PUBLIC', 'This repository is not public.')
  const commit = z.object({ sha: Sha, commit: z.object({ tree: z.object({ sha: Sha }) }) })
    .parse(await get(`${path}/commits/${encodeURIComponent(ref.commit ?? repo.default_branch)}`))
  if (ref.commit && commit.sha !== ref.commit) throw new ScanError('NO_SKILL_FOUND', 'The requested commit could not be resolved.')
  const parsed = Tree.safeParse(await get(`${path}/git/trees/${commit.commit.tree.sha}?recursive=1`))
  if (!parsed.success) throw new ScanError('NO_SKILL_FOUND', 'Invalid repository tree response.')
  const tree = parsed.data
  if (tree.truncated) throw tooLarge()
  if (tree.sha !== commit.commit.tree.sha) throw new ScanError('NO_SKILL_FOUND', 'The requested tree could not be resolved.')
  return { path, commit: commit.sha, entries: tree.tree }
}

async function blob(path: string, entry: Entry, folder: string, get: Get): Promise<BundleEntry> {
  const base64Length = 4 * Math.ceil(entry.size! / 3)
  const jsonLimit = base64Length + Math.ceil(base64Length / 60) * 4 + 4096
  const data = z.object({ sha: Sha, size: z.number().int().nonnegative(), encoding: z.literal('base64'), content: z.string() })
    .parse(await get(`${path}/git/blobs/${entry.sha}`, jsonLimit))
  const encoded = data.content.replace(/[\r\n]/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new ScanError('NO_SKILL_FOUND', 'Invalid blob encoding.')
  }
  const bytes = Uint8Array.from(Buffer.from(encoded, 'base64'))
  if (data.sha !== entry.sha || data.size !== entry.size || bytes.length !== entry.size) {
    throw new ScanError('NO_SKILL_FOUND', 'Blob metadata does not match the pinned tree.')
  }
  return { path: entry.path.slice(folder ? folder.length + 1 : 0), kind: entry.mode === '120000' ? 'symlink' : 'file', bytes }
}

async function fetchBundle(input: SkillRef, get: Get): Promise<BundleEntry[]> {
  const ref = Ref.extend({ commit: Sha, path: Path }).parse(input)
  const tree = await treeFor(ref, get), entries = validateEntries(tree.entries, ref.path)
  const bundle: BundleEntry[] = []
  for (const entry of entries) bundle.push(await blob(tree.path, entry, ref.path, get))
  try { contentHash(bundle) } catch (error) {
    if (error instanceof BundleError && ['TOO_MANY_FILES', 'TOO_LARGE'].includes(error.code)) throw tooLarge()
    throw new ScanError('NO_SKILL_FOUND', 'Invalid skill bundle.')
  }
  return bundle
}

export function createGitHubFetcher(options: Options = {}): RepoFetcher {
  const get = createApi(options)
  return {
    listSkillFolders: async (ref) => {
      const tree = await treeFor(ref, get)
      const folders = tree.entries.filter((entry) => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)
        && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')))
        .map(({ path }) => path === 'SKILL.md' ? '' : path.slice(0, -'/SKILL.md'.length))
      return { commit: tree.commit, folders: [...new Set(folders)].sort() }
    },
    fetchBundle: (input) => fetchBundle(input, get),
  }
}
