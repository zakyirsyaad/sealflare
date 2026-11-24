import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

export function versionSources(): [string, string][] {
  return ['probes', 'wallet'].flatMap((directory) => readdirSync(new URL(`../src/${directory}/`, import.meta.url))
    .filter((name) => name.endsWith('.ts') && !(directory === 'probes' && name === 'version.ts'))
    .map((name): [string, string] => [`${directory}/${name}`, readFileSync(new URL(`../src/${directory}/${name}`, import.meta.url), 'utf8')]))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
}

export function versionOf(sources: [string, string][] = versionSources()): string {
  return `v1-${createHash('sha256').update(JSON.stringify(sources)).digest('hex').slice(0, 32)}`
}
