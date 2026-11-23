import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import type { BundleEntry } from '@sealflare/shared/rules'

export const file = (path: string, text: string): BundleEntry => ({ path, kind: 'file', bytes: new TextEncoder().encode(text) })
export function loadSkill(folder: string): BundleEntry[] {
  const root = fileURLToPath(new URL(`../fixtures/skills/${folder}/`, import.meta.url))
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ path: relative(root, join(entry.parentPath, entry.name)), kind: 'file' as const,
      bytes: new Uint8Array(readFileSync(`${entry.parentPath}/${entry.name}`)) }))
}
