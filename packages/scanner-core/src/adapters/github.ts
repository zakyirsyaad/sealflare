// APIs checked 2026-11-25:
// https://docs.github.com/en/rest/git/trees#get-a-tree
// https://docs.github.com/en/rest/git/blobs#get-a-blob
// https://docs.github.com/en/rest/commits/commits#get-a-commit
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { CONSTANTS, EXCLUDED_PATH, MAX_PUBLISHER_SIG_BYTES, contentHash, BundleError, type BundleEntry } from '@sealflare/shared/rules'
import { ScanError, SkillSource, type RepoFetcher, type RepoRef, type SkillRef } from '@sealflare/shared/schemas'
import { tooLarge, withGitHubApi, type GitHubOptions, type Get } from './github-api'

const Name = z.string().regex(/^[A-Za-z0-9_.-]+$/).refine((value) => value !== '.' && value !== '..')
const Ref = z.object({ owner: Name, repo: Name, commit: SkillSource.shape.commit.optional(), branch: Name.optional() })
const Path = SkillSource.shape.path.refine((value) => !value.includes('\0') && value.isWellFormed())
const Sha = z.string().regex(/^[0-9a-f]{40}$/)
const Entry = z.object({ path: Path.refine((value) => value !== ''), sha: Sha,
  mode: z.enum(['100644', '100755', '120000', '040000', '160000']),
  type: z.enum(['blob', 'tree', 'commit']), size: z.number().int().nonnegative().optional(),
}).refine((entry) => entry.mode === '040000' ? entry.type === 'tree'
  : entry.mode === '160000' ? entry.type === 'commit' : entry.type === 'blob' && entry.size !== undefined)
const LooseEntry = z.object({ path: z.string(), sha: z.unknown().optional(), mode: z.unknown().optional(),
  type: z.unknown().optional(), size: z.unknown().optional() })
const Tree = z.object({ sha: Sha, truncated: z.boolean(), tree: z.array(LooseEntry) })
type Entry = z.infer<typeof Entry>
type LooseEntry = z.infer<typeof LooseEntry>

function strictEntries(entries: LooseEntry[]): Entry[] {
  const parsed = z.array(Entry).safeParse(entries)
  if (!parsed.success) throw new ScanError('NO_SKILL_FOUND', 'Invalid file in the selected repository paths.')
  return parsed.data
}

function validateEntries(entries: LooseEntry[], folder: string): Entry[] {
  const prefix = folder ? `${folder}/` : ''
  const selected = strictEntries(entries.filter((entry) => entry.path.startsWith(prefix) || entry.path === folder))
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

async function resolveRepository(input: RepoRef, get: Get) {
  const ref = Ref.parse(input), path = `/repos/${ref.owner}/${ref.repo}`
  if (ref.commit && ref.branch) throw new ScanError('INPUT_NOT_RECOGNIZED', 'Choose a commit or branch, not both.')
  const repo = z.object({ private: z.boolean(), default_branch: z.string().min(1) }).parse(await get(path))
  if (repo.private) throw new ScanError('REPO_NOT_PUBLIC', 'This repository is not public.')
  const commit = z.object({ sha: Sha, commit: z.object({ tree: z.object({ sha: Sha }) }) })
    .parse(await get(`${path}/commits/${encodeURIComponent(ref.commit ?? ref.branch ?? repo.default_branch)}`))
  if (ref.commit && commit.sha !== ref.commit) throw new ScanError('NO_SKILL_FOUND', 'The requested commit could not be resolved.')
  return { path, commit: commit.sha, sha: commit.commit.tree.sha }
}

async function readTree(path: string, sha: string, recursive: boolean, get: Get) {
  const parsed = Tree.safeParse(await get(`${path}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`))
  if (!parsed.success) throw new ScanError('NO_SKILL_FOUND', 'Invalid repository tree response.')
  const tree = parsed.data
  if (tree.truncated) throw tooLarge()
  if (tree.sha !== sha) throw new ScanError('NO_SKILL_FOUND', 'The requested tree could not be resolved.')
  return tree.tree
}

async function selectedTree(path: string, rootSha: string, folder: string, get: Get) {
  let sha = rootSha
  for (const segment of folder ? folder.split('/') : []) {
    const entries = await readTree(path, sha, false, get)
    const matches = strictEntries(entries.filter(({ path }) => path === segment))
    if (matches.length !== 1 || matches[0]!.type !== 'tree' || matches[0]!.mode !== '040000') {
      throw new ScanError('NO_SKILL_FOUND', 'The selected skill folder is not a regular directory.')
    }
    sha = matches[0]!.sha
  }
  return readTree(path, sha, true, get)
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

async function downloadBlobs(path: string, entries: Entry[], get: Get, concurrency: number,
  controller: AbortController,
): Promise<BundleEntry[]> {
  const bundle: BundleEntry[] = new Array(entries.length)
  let next = 0
  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = next++
      if (index >= entries.length) return
      try { bundle[index] = await blob(path, entries[index]!, '', get) }
      catch (error) { controller.abort(); throw error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  controller.signal.throwIfAborted()
  return bundle
}

async function fetchBundle(input: SkillRef, options: GitHubOptions): Promise<BundleEntry[]> {
  const ref = Ref.extend({ commit: Sha, path: Path }).parse(input)
  return withGitHubApi(options, async ({ get, checkBlobBudget }, controller) => {
    const tree = await resolveRepository(ref, get)
    const entries = validateEntries(await selectedTree(tree.path, tree.sha, ref.path, get), '')
    checkBlobBudget(entries.length)
    const bundle = await downloadBlobs(tree.path, entries, get, options.maxConcurrency ?? 4, controller)
    try { contentHash(bundle) } catch (error) {
      if (error instanceof BundleError && ['TOO_MANY_FILES', 'TOO_LARGE'].includes(error.code)) throw tooLarge()
      throw new ScanError('NO_SKILL_FOUND', 'Invalid skill bundle.')
    }
    return bundle
  })
}

export function createGitHubFetcher(options: GitHubOptions = {}): RepoFetcher {
  z.object({ maxConcurrency: z.number().int().min(1).max(8).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).optional() }).parse(options)
  return {
    listSkillFolders: (ref) => withGitHubApi(options, async ({ get }) => {
      const tree = await resolveRepository(ref, get)
      const entries = await readTree(tree.path, tree.sha, true, get)
      const candidates = entries.filter((entry) => entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md'))
      const folders = strictEntries(candidates).filter((entry) => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode))
        .map(({ path }) => path === 'SKILL.md' ? '' : path.slice(0, -'/SKILL.md'.length))
      return { commit: tree.commit, folders: [...new Set(folders)].sort() }
    }),
    fetchBundle: (input) => fetchBundle(input, options),
  }
}
