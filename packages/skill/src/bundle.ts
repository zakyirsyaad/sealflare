import { spawnSync } from 'node:child_process'
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
  /** The files the registry hashes: the tracked files of a git work tree, or every file outside git. */
  hashed: BundleEntry[]
  /** The files of the folder that are not in the bundle. They are scanned, never hashed. */
  extra: BundleEntry[]
  /** The files outside the bundle that were not read, because there were more of them than the limit. */
  unread: number
}

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

/**
 * The files that git tracks in a folder, or null when the folder is not inside a git work tree.
 *
 * The registry hashes the tree of the repository, so a local folder is the same bundle only when it
 * holds the files that are committed. The paths are relative to the folder.
 */
export function gitTrackedFiles(folder: string): string[] | null {
  const result = spawnSync('git', ['-C', folder, 'ls-files', '--cached', '-z'], { encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return null
  const listing = typeof result.stdout === 'string' ? result.stdout : ''
  return listing.split('\0').filter(path => path.length > 0)
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
 * The bundle of a local folder, the way the registry reads it.
 *
 * Inside a git work tree the registry hashes the committed tree, so only the tracked files are
 * hashed here. The other files of the folder are read and scanned, so a file that is not part of
 * the bundle is never hidden, but it never changes the hash or the target id. Outside git every
 * file of the folder is part of the bundle.
 */
export async function readBundle(folder: string): Promise<LocalBundle> {
  const tracked = gitTrackedFiles(folder)
  const all = await listFiles(folder)
  if (tracked === null) {
    assertFileCount(all)
    const hashed = await readBundleFiles(folder, all)
    assertWithinBytes(hashed)
    return { hashed, extra: [], unread: 0 }
  }
  const present = new Set(all)
  const trackedPaths = tracked.filter(path => present.has(path))
  if (trackedPaths.length === 0) {
    throw new Error('This folder is inside a git repository but holds no tracked file, so it has no bundle to hash. Commit the files, or scan a folder outside git.')
  }
  assertFileCount(trackedPaths)
  const hashed = await readBundleFiles(folder, trackedPaths)
  assertWithinBytes(hashed)
  const trackedSet = new Set(trackedPaths)
  const extraPaths = all.filter(path => !trackedSet.has(path))
  const extra = await readBundleFiles(folder, extraPaths.slice(0, MAX_EXTRA_FILES))
  return { hashed, extra, unread: extraPaths.length - extra.length }
}
