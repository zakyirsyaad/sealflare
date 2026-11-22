import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Address, type Hex, hexToBytes } from 'viem'
import type { BundleEntry } from '../rules'

const fixturePath = (relative: string) => fileURLToPath(new URL(`../fixtures/${relative}`, import.meta.url))

export const loadJson = <T = unknown>(relative: string): T => JSON.parse(readFileSync(fixturePath(relative), 'utf8')) as T

export type BundleFixture = {
  entries: BundleEntry[]
  manifestPublisher: Address
  expected: { contentHash: Hex; canonicalBundleHash: Hex; targetId: Hex } | null
}

export function loadBundle(name: string): BundleFixture {
  const raw = loadJson<{
    entries: { path: string; kind: 'file' | 'symlink'; hex: Hex }[]
    manifestPublisher: Address
    expected: BundleFixture['expected']
  }>(`bundles/${name}.json`)
  return {
    ...raw,
    entries: raw.entries.map(({ path, kind, hex }) => ({ path, kind, bytes: hexToBytes(hex) })),
  }
}

export const file = (path: string, text = 'x'): BundleEntry => ({ path, kind: 'file', bytes: new TextEncoder().encode(text) })
