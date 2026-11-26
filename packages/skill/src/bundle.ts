import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { CONSTANTS, EXCLUDED_PATH, type BundleEntry } from '@sealflare/shared/rules'
import {
  bundleOf,
  committedFiles,
  repositoryOf,
  sourceOf,
  stagedFiles,
  untrackedFiles,
  type BundleSource,
  type Repository,
} from './git'
import { toPosix } from './paths'

/**
 * How the bundle of a local folder is read.
 *
 * Inside a git work tree the registry hashes the committed tree, so only the committed files are
 * hashed here, with the content of the commit and not the content of the working copy. The other
 * files of the folder are read and scanned, so a file that is not part of the bundle is never
 * hidden, but it never changes the hash or the target id. Outside git every file of the folder is
 * part of the bundle.
 */

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

/**
 * How many bytes the files outside the bundle may hold in all. The files are read in parts, so a
 * folder with a large dependency tree does not fill the memory of the command. A file that does not
 * fit is counted and never read.
 */
const MAX_EXTRA_BYTES = 4 * CONSTANTS.MAX_BUNDLE_BYTES

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

/** The same count of bytes, taken from the sizes of a committed tree instead of from the files. */
function assertWithinSize(files: readonly { path: string; size: number }[]): void {
  const bytes = files.filter(file => file.path !== EXCLUDED_PATH).reduce((sum, file) => sum + file.size, 0)
  if (bytes > CONSTANTS.MAX_BUNDLE_BYTES) {
    throw new Error(`The folder holds more than ${CONSTANTS.MAX_BUNDLE_BYTES} bytes, which is more than a skill bundle may hold.`)
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
  if (files.length === 0) {
    throw new Error('This folder is inside a git repository but holds no committed file, so it has no bundle to hash. Commit the files, or scan a folder outside git.')
  }
  // The limits are checked on the tree, before a single blob is read.
  assertFileCount(files.map(file => file.path))
  assertWithinSize(files)
  const hashed = bundleOf(repository, files)
  const { entries, unread } = await extraFiles(folder, repository, hashed)
  return { hashed, extra: entries, unread, source: sourceOf(repository) }
}

/**
 * The files of the folder that are not in the bundle.
 *
 * The files that a person wrote and did not commit come first, then the files that git ignores, so
 * a dependency tree never fills the limit before a file of the skill itself is read.
 *
 * The number of files and the number of bytes are both capped. The size of a file is read before
 * its bytes are, so a huge file is never held in memory, and a file that does not fit is counted
 * as one that was not read. A nested repository is counted the same way, because its files are not
 * read either. The report treats every file that was not read as a file that was not scanned.
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
  let unread = 0
  for (const ignored of [false, true]) {
    const listing = untrackedFiles(repository, ignored)
    unread += listing.nested
    for (const path of listing.paths) {
      if (!inBundle.has(path) && !ordered.includes(path)) ordered.push(path)
    }
  }
  const entries: BundleEntry[] = []
  let bytes = 0
  for (const path of ordered) {
    const size = await sizeOf(folder, path)
    // A file that is listed but no longer on disk holds nothing that could be read or hidden.
    if (size === 'gone') continue
    if (size === null || entries.length >= MAX_EXTRA_FILES || bytes + size > MAX_EXTRA_BYTES) {
      unread += 1
      continue
    }
    try {
      const entry = await readEntry(folder, path)
      entries.push(entry)
      bytes += entry.bytes.length
    } catch {
      unread += 1
    }
  }
  return { entries, unread }
}

/**
 * The size of a file in bytes, `gone` when it is not on disk any more, or null when it is not a
 * file that can be read.
 *
 * A folder is not a file, so it is never read. The size comes from the directory entry, so the
 * bytes of a file are not held in memory before it is known that it fits.
 */
async function sizeOf(folder: string, path: string): Promise<number | 'gone' | null> {
  try {
    const info = await lstat(join(folder, path))
    if (info.isDirectory()) return null
    return info.size
  } catch (failure) {
    return (failure as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : null
  }
}
