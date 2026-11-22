import { expect, test } from 'vitest'
import ids from '../rules/vectors/ids.json'
import { type BundleEntry, ZERO_ADDRESS, canonicalBundleHash, contentHash, targetIdOfContract, targetIdOfSkill } from '../rules'
import { file, loadBundle } from './helpers'

const hashOf = (name: string) => contentHash(loadBundle(name).entries)
const PUBLISHER = '0x1111111111111111111111111111111111111111'

test('order of entries does not change the hash', () => {
  expect(hashOf('shuffled')).toBe(hashOf('basic'))
})
test('a zero-width character changes the hash', () => {
  expect(hashOf('zero-width')).not.toBe(hashOf('basic'))
})
test('publisher.sig at the root is excluded', () => {
  expect(hashOf('publisher-sig-root')).toBe(hashOf('basic'))
})
test('publisher.sig in a subfolder is included', () => {
  expect(hashOf('publisher-sig-nested')).not.toBe(hashOf('basic'))
})
test('a symlink hashes its target text and differs from a file with the same bytes', () => {
  const asFile = loadBundle('symlink').entries.map((e) => ({ ...e, kind: 'file' as const }))
  expect(hashOf('symlink')).not.toBe(contentHash(asFile))
})
test('moving bytes between a path and its content changes the hash', () => {
  expect(contentHash([file('ab', 'c')])).not.toBe(contentHash([file('a', 'bc')]))
})
test('the publisher address is an input to the canonical hash', () => {
  const c = hashOf('basic')
  expect(canonicalBundleHash(c, PUBLISHER)).not.toBe(canonicalBundleHash(c, ZERO_ADDRESS))
})
test('the canonical hash ignores address letter case', () => {
  const c = hashOf('basic')
  expect(canonicalBundleHash(c, '0xABCDEFabcdef1234567890ABCDEFabcdef123456')).toBe(
    canonicalBundleHash(c, '0xabcdefabcdef1234567890abcdefabcdef123456'),
  )
})
test('sorts by UTF-8 bytes, not by locale', () => {
  const entries = [file('a'), file('B'), file('é')]
  expect(contentHash(entries)).toBe(contentHash([file('B'), file('a'), file('é')]))
  expect(contentHash(entries)).not.toBe(contentHash([file('a'), file('b'), file('é')]))
})
test.each<[string, BundleEntry[]]>([
  ['EMPTY', []],
  ['EMPTY', [file('publisher.sig')]],
  ['DUPLICATE_PATH', [file('a'), file('a')]],
  ['INVALID_PATH', [file('/abs')]],
  ['INVALID_PATH', [file('a/../b')]],
  ['INVALID_PATH', [file('./a')]],
  ['INVALID_PATH', [file('a//b')]],
  ['INVALID_PATH', [file('a/')]],
  ['INVALID_PATH', [file('')]],
  ['INVALID_PATH', [file('a\\b')]],
  ['INVALID_PATH', [file('a\u0000b')]],
])('rejects %s', (code, entries) => {
  expect(() => contentHash(entries)).toThrowError(expect.objectContaining({ code }))
})
test('rejects more than 200 files instead of truncating', () => {
  const many = Array.from({ length: 201 }, (_, i) => file(`f${i}`))
  expect(() => contentHash(many)).toThrowError(expect.objectContaining({ code: 'TOO_MANY_FILES' }))
  expect(() => contentHash(many.slice(0, 200))).not.toThrow()
})
test('rejects more than 2 MiB instead of truncating', () => {
  const big = (size: number): BundleEntry[] => [{ path: 'big', kind: 'file', bytes: new Uint8Array(size) }]
  expect(() => contentHash(big(2_097_153))).toThrowError(expect.objectContaining({ code: 'TOO_LARGE' }))
  expect(() => contentHash(big(2_097_152))).not.toThrow()
})
test('does not mutate the entries it is given', () => {
  const entries = [file('b'), file('a')]
  contentHash(entries)
  expect(entries.map((e) => e.path)).toEqual(['b', 'a'])
})
test.each(['basic', 'zero-width', 'symlink', 'with-publisher'])('%s matches its frozen expected values', (name) => {
  const f = loadBundle(name)
  const c = contentHash(f.entries)
  expect(f.expected).not.toBeNull()
  expect(c).toBe(f.expected!.contentHash)
  expect(canonicalBundleHash(c, f.manifestPublisher)).toBe(f.expected!.canonicalBundleHash)
  expect(targetIdOfSkill(f.expected!.canonicalBundleHash)).toBe(f.expected!.targetId)
})
test.each(ids.contracts)('contract $address has the frozen target id', ({ address, targetId }) => {
  expect(targetIdOfContract(address as `0x${string}`)).toBe(targetId)
})
test.each(ids.skills)('skill content $contentHash has the frozen ids', (row) => {
  const canonical = canonicalBundleHash(row.contentHash as `0x${string}`, row.publisher as `0x${string}`)
  expect(canonical).toBe(row.canonicalBundleHash)
  expect(targetIdOfSkill(canonical)).toBe(row.targetId)
})

// ---- added after the final review ----
test('publisher.sig must be a small regular file', () => {
  const sig = (kind: 'file' | 'symlink', size: number): BundleEntry => ({ path: 'publisher.sig', kind, bytes: new Uint8Array(size) })
  expect(() => contentHash([file('a'), sig('file', 1024)])).not.toThrow()
  expect(() => contentHash([file('a'), sig('file', 1025)])).toThrowError(expect.objectContaining({ code: 'TOO_LARGE' }))
  expect(() => contentHash([file('a'), sig('symlink', 10)])).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }))
})
