import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { BundleEntry } from '@sealflare/shared/rules'

/** Folders that never belong to a skill bundle and would only break the size limits. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', '.next', 'test-results'])

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

/** Every file of a folder, as the entries of a bundle. The paths are relative and POSIX. */
export async function readFolder(folder: string): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = []
  async function walk(current: string): Promise<void> {
    const items = await readdir(current, { withFileTypes: true })
    for (const item of items.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (SKIPPED.has(item.name)) continue
      const full = join(current, item.name)
      if (item.isDirectory()) {
        await walk(full)
        continue
      }
      if (!item.isFile() && !item.isSymbolicLink()) continue
      const path = toPosix(relative(folder, full))
      entries.push(await readEntry(folder, path))
    }
  }
  await walk(folder)
  return entries
}
