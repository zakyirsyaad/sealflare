import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { BundleEntry } from '@sealflare/shared/rules'
import { toPosix } from './paths'

/**
 * Everything this module does with git.
 *
 * Git reads the repository it is pointed at, and the repository can hold a configuration that makes
 * git run a command. So git runs in an environment of its own, and the environment says what it may
 * do. The bundle of a work tree is the committed tree of that work tree, the way the registry
 * hashes the tree of a repository on GitHub.
 */

type GitOutput = { ok: true; out: Buffer } | { ok: false; why: string }

/**
 * The variables that point git at another repository, another index or another configuration.
 *
 * They are dropped, so the folder that is scanned is the only thing git reads. A `GIT_DIR` of the
 * shell of the user would otherwise make git read another repository entirely.
 */
const INHERITED_GIT_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
]

/**
 * The environment git runs in.
 *
 * The lazy download of a missing object is switched off and every protocol is refused, so a bundle
 * that ships a repository of its own can never make git run a command or reach the network. The
 * system and the global configuration are ignored, so a setting of the machine cannot change what
 * is read. The language is fixed, so the messages of git are the same for every user.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of INHERITED_GIT_KEYS) delete env[key]
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')) delete env[key]
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: 'none',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  }
}

/**
 * Git is run with the file monitor of the repository switched off, because git reads that setting
 * from the `.git/config` of the repository and runs the command it names. A bundle that ships a
 * repository of its own must never be able to make git run a command.
 */
export function git(folder: string, args: readonly string[]): GitOutput {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', folder, ...args], {
    encoding: 'buffer',
    env: gitEnv(),
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error !== undefined) return { ok: false, why: result.error.message }
  if (result.status !== 0) {
    const why = result.stderr?.toString('utf8').trim() ?? ''
    return { ok: false, why: why.length > 0 ? why : `git exited with code ${result.status}` }
  }
  return { ok: true, out: result.stdout ?? Buffer.alloc(0) }
}

/** The repository the folder sits in: its root, and the folder inside it. */
export type Repository = { root: string; prefix: string }

/** The repository, the commit and the folder in it, as the application names a skill. */
export type BundleSource = { repo: string; commit: string; path: string }

/**
 * The `.git` folder of the repository the folder sits in, or null when it sits in none.
 *
 * The folder is looked for in the folder itself and in its parents, so the answer does not depend
 * on the language of git: the message of git is translated, and a folder outside git would look
 * like a broken repository for a user whose shell is in another language. A `.git` folder without a
 * `HEAD` is not a repository, so a bundle that ships one is read as a plain folder.
 */
function gitFolderOf(folder: string): string | null {
  let current = realpathSync(folder)
  while (true) {
    const candidate = join(current, '.git')
    if (existsSync(join(candidate, 'HEAD'))) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * The repository the folder sits in, or null when the folder is not inside one.
 *
 * A git that will not work with the repository is an error, not a folder outside git: a repository
 * with a doubtful owner or a broken configuration would otherwise be read as a plain folder and
 * hashed in full.
 */
export function repositoryOf(folder: string): Repository | null {
  if (gitFolderOf(folder) === null) return null
  const result = git(folder, ['rev-parse', '--show-toplevel'])
  if (!result.ok) {
    throw new Error(`This folder is inside a git repository that git will not work with: ${result.why}`)
  }
  const root = realpathSync(result.out.toString('utf8').trim())
  const inside = toPosix(relative(root, realpathSync(folder)))
  return { root, prefix: inside === '.' ? '' : inside }
}

type TreeFile = { path: string; mode: string; oid: string }

/** The files of the committed tree of the repository, with the paths relative to the folder. */
export function committedFiles(repository: Repository): TreeFile[] {
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
export function bundleOf(repository: Repository, files: readonly TreeFile[]): BundleEntry[] {
  const entries: BundleEntry[] = []
  for (const file of files) {
    // A submodule is a commit of another repository. The registry publishes the files of a
    // repository, so a bundle with a submodule can never be the bundle of the registry.
    if (file.mode === '160000') {
      throw new Error(`This bundle holds a submodule at ${file.path}, which the registry can never publish. Remove it, or publish the folder without it.`)
    }
    const kind = file.mode === '120000' ? 'symlink' : 'file'
    entries.push({ path: file.path, kind, bytes: blobOf(repository, file.oid) })
  }
  return entries
}

/** The files of the repository that are not in its committed tree, as paths relative to the folder. */
export function untrackedFiles(repository: Repository, ignored: boolean): string[] {
  const args = ['ls-files', '--others', '--exclude-standard', '-z']
  if (ignored) args.splice(2, 0, '--ignored')
  const result = git(repository.root, args)
  if (!result.ok) return []
  return pathsOf(result.out, repository.prefix)
}

/** The files that are in the index of the repository but not in its committed tree. */
export function stagedFiles(repository: Repository): string[] {
  const result = git(repository.root, ['ls-files', '--cached', '-z'])
  if (!result.ok) return []
  return pathsOf(result.out, repository.prefix)
}

/** The paths of a NUL separated listing of git, relative to the folder. */
function pathsOf(out: Buffer, prefix: string): string[] {
  const paths: string[] = []
  for (const path of out.toString('utf8').split('\0')) {
    if (path.length === 0) continue
    // A nested repository is listed as a folder with a slash at the end. Its files belong to that
    // repository and not to this one, so the entry is left out.
    if (path.endsWith('/')) continue
    if (prefix === '') {
      paths.push(path)
      continue
    }
    if (!path.startsWith(`${prefix}/`)) continue
    paths.push(path.slice(prefix.length + 1))
  }
  return paths
}

/**
 * Where the bundle sits on GitHub, when the work tree has a GitHub remote.
 *
 * The link of the target page needs it, so the page can be rebuilt from the repository when the
 * cache of the application is gone. A work tree without a remote, or with a remote that is not on
 * GitHub, has no source and the link stays without one.
 */
export function sourceOf(repository: Repository): BundleSource | null {
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
