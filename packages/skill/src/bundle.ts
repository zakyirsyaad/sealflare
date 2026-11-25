import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { CONSTANTS, EXCLUDED_PATH, type BundleEntry } from '@sealflare/shared/rules'

/**
 * The only folder that is never part of a bundle. A git tree cannot hold an entry named `.git`, so
 * the registry never sees one.
 */
const GIT_METADATA = '.git'

/**
 * How many files outside the bundle are read. The files outside the bundle are never hashed, so a
 * folder with a large dependency tree does not drown the report. The files that are left out are
 * counted and shown, so nothing is hidden.
 */
const MAX_EXTRA_FILES = 500

export type LocalBundle = {
  /** The files the registry hashes: the committed files of a git work tree, or every file outside git. */
  hashed: BundleEntry[]
  /** The files of the folder that are not in the bundle. They are scanned, never hashed. */
  extra: BundleEntry[]
  /** The files outside the bundle that were not read, because there were more of them than the limit. */
  unread: number
  /** Where the bundle sits on GitHub, when the folder is a work tree with a GitHub remote. */
  source: BundleSource | null
}

/** The repository, the commit and the folder in it, as the application names a skill. */
export type BundleSource = { repo: string; commit: string; path: string }

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/** The bytes of a symlink are the text of its target. A link is never followed. */
async function readEntry(folder: string, path: string): Promise<BundleEntry> {
  const full = join(folder, path)
  const info = await lstat(full)
  if (info.isSymbolicLink()) {
    const target = await readlink(full)
    return { path, kind: 'symlink', bytes: new TextEncoder().encode(target) }
  }
  return { path, kind: 'file', bytes: new Uint8Array(await readFile(full)) }
}

/** The entries of a list of files that sit under a folder. The paths are relative and POSIX. */
export async function readBundleFiles(folder: string, paths: readonly string[]): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = []
  for (const path of paths) entries.push(await readEntry(folder, path))
  return entries
}

/** Every file of a folder, as paths relative to it and in POSIX form. */
async function listFiles(folder: string): Promise<string[]> {
  const paths: string[] = []
  async function walk(current: string): Promise<void> {
    const items = await readdir(current, { withFileTypes: true })
    for (const item of items.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (item.name === GIT_METADATA) continue
      const full = join(current, item.name)
      if (item.isDirectory()) {
        await walk(full)
        continue
      }
      if (!item.isFile() && !item.isSymbolicLink()) continue
      paths.push(toPosix(relative(folder, full)))
    }
  }
  await walk(folder)
  return paths
}

type GitOutput = { ok: true; out: Buffer } | { ok: false; why: string }

/**
 * Git is run with the file monitor of the repository switched off, because git reads that setting
 * from the `.git/config` of the repository and runs the command it names. A bundle that ships a
 * repository of its own must never be able to make git run a command.
 */
function git(folder: string, args: readonly string[]): GitOutput {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', folder, ...args], {
    encoding: 'buffer',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error !== undefined) return { ok: false, why: result.error.message }
  if (result.status !== 0) {
    const why = result.stderr?.toString('utf8').trim() ?? ''
    return { ok: false, why: why.length > 0 ? why : `git exited with code ${result.status}` }
  }
  return { ok: true, out: result.stdout ?? Buffer.alloc(0) }
}

type Repository = { root: string; prefix: string }

/**
 * The repository the folder sits in, or null when the folder is not inside one.
 *
 * A git that will not work with the repository is an error, not a folder outside git: a repository
 * with a doubtful owner or a broken configuration would otherwise be read as a plain folder and
 * hashed in full.
 */
function repositoryOf(folder: string): Repository | null {
  const result = git(folder, ['rev-parse', '--show-toplevel'])
  if (result.ok) {
    const root = realpathSync(result.out.toString('utf8').trim())
    const inside = toPosix(relative(root, realpathSync(folder)))
    return { root, prefix: inside === '.' ? '' : inside }
  }
  if (/not a git repository/i.test(result.why)) return null
  throw new Error(`This folder is inside a git repository that git will not work with: ${result.why}`)
}

type TreeFile = { path: string; mode: string; oid: string }

/** The files of the committed tree of the repository, with the paths relative to the folder. */
function committedFiles(repository: Repository): TreeFile[] {
  const head = git(repository.root, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) {
    throw new Error('This git repository has no commit yet, so it has no bundle to hash. Commit the files, or scan a folder outside git.')
  }
  const tree = git(repository.root, ['ls-tree', '-r', '-z', 'HEAD'])
  if (!tree.ok) throw new Error(`The committed tree could not be read: ${tree.why}`)
  return parseTree(tree.out.toString('utf8'), repository.prefix)
}

/** The records of `git ls-tree` are `<mode> <type> <oid>\t<path>`, separated by a NUL byte. */
function parseTree(listing: string, prefix: string): TreeFile[] {
  const files: TreeFile[] = []
  for (const record of listing.split('\0')) {
    if (record.length === 0) continue
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    const [mode, , oid] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (mode === undefined || oid === undefined) continue
    if (prefix === '') {
      files.push({ path, mode, oid })
      continue
    }
    if (!path.startsWith(`${prefix}/`)) continue
    files.push({ path: path.slice(prefix.length + 1), mode, oid })
  }
  return files
}

/** The bytes of a committed file. The content comes from the commit, not from the working tree. */
function blobOf(repository: Repository, oid: string): Uint8Array {
  const result = git(repository.root, ['cat-file', 'blob', oid])
  if (!result.ok) throw new Error(`A committed file could not be read: ${result.why}`)
  return new Uint8Array(result.out)
}

/** The bundle of a committed tree: the blobs of its files, and the target of its symlinks. */
function bundleOf(repository: Repository, files: readonly TreeFile[]): BundleEntry[] {
  const entries: BundleEntry[] = []
  for (const file of files) {
    if (file.mode === '160000') continue
    const kind = file.mode === '120000' ? 'symlink' : 'file'
    entries.push({ path: file.path, kind, bytes: blobOf(repository, file.oid) })
  }
  return entries
}

/** The files of the repository that are not in its committed tree, as paths relative to the folder. */
function untrackedFiles(repository: Repository, ignored: boolean): string[] {
  const args = ['ls-files', '--others', '--exclude-standard', '-z']
  if (ignored) args.splice(2, 0, '--ignored')
  const result = git(repository.root, args)
  if (!result.ok) return []
  return pathsOf(result.out, repository.prefix)
}

/** The files that are in the index of the repository but not in its committed tree. */
function stagedFiles(repository: Repository): string[] {
  const result = git(repository.root, ['ls-files', '--cached', '-z'])
  if (!result.ok) return []
  return pathsOf(result.out, repository.prefix)
}

/** The paths of a NUL separated listing of git, relative to the folder. */
function pathsOf(out: Buffer, prefix: string): string[] {
  const paths: string[] = []
  for (const path of out.toString('utf8').split('\0')) {
    if (path.length === 0) continue
    if (prefix === '') {
      paths.push(path)
      continue
    }
    if (!path.startsWith(`${prefix}/`)) continue
    paths.push(path.slice(prefix.length + 1))
  }
  return paths
}

/** The working copy of a file of the bundle, when it differs from the committed content. */
async function modifiedEntry(folder: string, entry: BundleEntry): Promise<BundleEntry | null> {
  try {
    const working = await readEntry(folder, entry.path)
    const same = working.kind === entry.kind && Buffer.compare(Buffer.from(working.bytes), Buffer.from(entry.bytes)) === 0
    return same ? null : working
  } catch {
    return null
  }
}

/**
 * The limits of a bundle, the way the registry counts them: the files other than `publisher.sig`
 * and the bytes of those files. The signature is left out of the hash, so it is left out of the
 * count as well.
 */
function assertFileCount(paths: readonly string[]): void {
  const counted = paths.filter(path => path !== EXCLUDED_PATH).length
  if (counted > CONSTANTS.MAX_BUNDLE_FILES) {
    throw new Error(`The folder holds more than ${CONSTANTS.MAX_BUNDLE_FILES} files, which is more than a skill bundle may hold.`)
  }
}

/** The bytes of the bundle, the way the registry counts them: the signature is left out. */
function assertWithinBytes(entries: readonly BundleEntry[]): void {
  const bytes = entries
    .filter(entry => entry.path !== EXCLUDED_PATH)
    .reduce((sum, entry) => sum + entry.bytes.length, 0)
  if (bytes > CONSTANTS.MAX_BUNDLE_BYTES) {
    throw new Error(`The folder holds more than ${CONSTANTS.MAX_BUNDLE_BYTES} bytes, which is more than a skill bundle may hold.`)
  }
}

/**
 * Where the bundle sits on GitHub, when the work tree has a GitHub remote.
 *
 * The link of the target page needs it, so the page can be rebuilt from the repository when the
 * cache of the application is gone. A work tree without a remote, or with a remote that is not on
 * GitHub, has no source and the link stays without one.
 */
function sourceOf(repository: Repository): BundleSource | null {
  const remote = git(repository.root, ['remote', 'get-url', 'origin'])
  if (!remote.ok) return null
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote.out.toString('utf8').trim())
  if (!match) return null
  const commit = git(repository.root, ['rev-parse', 'HEAD'])
  if (!commit.ok) return null
  const sha = commit.out.toString('utf8').trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) return null
  return { repo: `${match[1]}/${match[2]}`, commit: sha, path: repository.prefix }
}

/**
 * The bundle of a local folder, the way the registry reads it.
 *
 * Inside a git work tree the registry hashes the committed tree, so only the committed files are
 * hashed here, with the content of the commit and not the content of the working copy. The other
 * files of the folder are read and scanned, so a file that is not part of the bundle is never
 * hidden, but it never changes the hash or the target id. Outside git every file of the folder is
 * part of the bundle.
 */
export async function readBundle(folder: string): Promise<LocalBundle> {
  const repository = repositoryOf(folder)
  if (repository === null) {
    const all = await listFiles(folder)
    assertFileCount(all)
    const hashed = await readBundleFiles(folder, all)
    assertWithinBytes(hashed)
    return { hashed, extra: [], unread: 0, source: null }
  }
  const files = committedFiles(repository)
  const hashed = bundleOf(repository, files)
  if (hashed.length === 0) {
    throw new Error('This folder is inside a git repository but holds no committed file, so it has no bundle to hash. Commit the files, or scan a folder outside git.')
  }
  assertFileCount(hashed.map(entry => entry.path))
  assertWithinBytes(hashed)
  const { entries, unread } = await extraFiles(folder, repository, hashed)
  return { hashed, extra: entries, unread, source: sourceOf(repository) }
}

/**
 * The files of the folder that are not in the bundle.
 *
 * The files that a person wrote and did not commit come first, then the files that git ignores, so
 * a dependency tree never fills the limit before a file of the skill itself is read.
 */
async function extraFiles(
  folder: string,
  repository: Repository,
  hashed: readonly BundleEntry[],
): Promise<{ entries: BundleEntry[]; unread: number }> {
  const inBundle = new Set(hashed.map(entry => entry.path))
  const ordered: string[] = []
  for (const entry of hashed) {
    const working = await modifiedEntry(folder, entry)
    if (working !== null) ordered.push(entry.path)
  }
  for (const path of stagedFiles(repository)) {
    if (!inBundle.has(path)) ordered.push(path)
  }
  for (const path of untrackedFiles(repository, false)) {
    if (!inBundle.has(path) && !ordered.includes(path)) ordered.push(path)
  }
  for (const path of untrackedFiles(repository, true)) {
    if (!inBundle.has(path) && !ordered.includes(path)) ordered.push(path)
  }
  const entries: BundleEntry[] = []
  for (const path of ordered.slice(0, MAX_EXTRA_FILES)) {
    entries.push(await readEntry(folder, path))
  }
  return { entries, unread: Math.max(0, ordered.length - entries.length) }
}
