import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { CONSTANTS, EXCLUDED_PATH, type BundleEntry } from '@sealflare/shared/rules'

/**
 * The only folder that is never part of a bundle. A git tree cannot hold an entry named `.git`, so
 * the registry never sees one. Every other folder, `node_modules` and `dist` included, is read
 * and hashed, because the bundle on GitHub holds those files too.
 */
const GIT_METADATA = '.git'

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

/**
 * Every file of a folder, as the entries of a bundle, the way the registry reads a bundle: all
 * files, with only `publisher.sig` left out of the hash later. A folder that is larger than the
 * limits of a bundle fails here, before its files are read, and is never cut short.
 */
export async function readFolder(folder: string): Promise<BundleEntry[]> {
  const paths: string[] = []
  let bytes = 0
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
      const path = toPosix(relative(folder, full))
      if (path !== EXCLUDED_PATH) {
        if (paths.length >= CONSTANTS.MAX_BUNDLE_FILES) {
          throw new Error(`The folder holds more than ${CONSTANTS.MAX_BUNDLE_FILES} files, which is more than a skill bundle may hold.`)
        }
        bytes += (await lstat(full)).size
        if (bytes > CONSTANTS.MAX_BUNDLE_BYTES) {
          throw new Error(`The folder holds more than ${CONSTANTS.MAX_BUNDLE_BYTES} bytes, which is more than a skill bundle may hold.`)
        }
      }
      paths.push(path)
    }
  }
  await walk(folder)
  return readBundleFiles(folder, paths)
}
