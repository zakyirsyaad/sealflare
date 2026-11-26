import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function walk(root: string, directory: string): [string, string][] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return walk(root, path)
    return entry.isFile() && entry.name.endsWith('.ts') && path !== 'probes/version.ts'
      ? [[path, readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')]] : []
  })
}

export function versionSources(root = fileURLToPath(new URL('../src/', import.meta.url))): [string, string][] {
  return ['probes', 'wallet'].flatMap((directory) => walk(root, directory))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
}

export function versionOf(sources: [string, string][] = versionSources()): string {
  const normalized = sources.map(([path, text]) => [path, text.replaceAll('\r\n', '\n')])
  return `v1-${createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32)}`
}
