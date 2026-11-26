import { beforeEach, expect, test, vi } from 'vitest'
import type { ScanReport } from '@sealflare/shared/schemas'
import noViolation from '@sealflare/shared/fixtures/sandbox/no-violation.json'

const { internalRead } = vi.hoisted(() => ({ internalRead: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalRead }
})

const { loadCachedSandbox } = await import('../server/sandbox')
const { sandboxSourceOf } = await import('../server/target')

const BUNDLE = `0x${'ab'.repeat(32)}`
const RESULT = noViolation

function skillScan(): ScanReport {
  return {
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: `0x${'cd'.repeat(32)}`,
    source: {
      kind: 'skill',
      repo: 'sealflare/demo',
      commit: 'a'.repeat(40),
      path: 'skills/demo',
      contentHash: `0x${'11'.repeat(32)}`,
      manifestPublisher: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      canonicalBundleHash: BUNDLE,
      fileCount: 1,
      totalBytes: 64,
    },
    scannedAt: '2026-11-26T09:00:00.000Z',
    checks: [],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  } as unknown as ScanReport
}

beforeEach(() => {
  internalRead.mockReset()
})

test('the result of the cache is read from the internal service', async () => {
  internalRead.mockResolvedValue({ data: { result: RESULT }, meta: {} })
  const result = await loadCachedSandbox(BUNDLE)
  expect(result?.status).toBe('NO_VIOLATION_OBSERVED')
  expect(internalRead).toHaveBeenCalledWith(`/sandbox/cache/${BUNDLE}`)
})

test('a bundle that was never run has no result and no failure', async () => {
  const { InternalServiceError } = await import('../server/internal')
  internalRead.mockRejectedValue(new InternalServiceError('RESULT_NOT_CACHED', 'This result is no longer cached.'))
  expect(await loadCachedSandbox(BUNDLE)).toBeNull()
})

test('a cache that cannot be read leaves the page without a result', async () => {
  internalRead.mockRejectedValue(new Error('the socket closed'))
  expect(await loadCachedSandbox(BUNDLE)).toBeNull()
})

test('a result of the wrong shape is no result', async () => {
  internalRead.mockResolvedValue({ data: { result: { status: 'SAFE' } }, meta: {} })
  expect(await loadCachedSandbox(BUNDLE)).toBeNull()
})

test('no bundle means no read at all', async () => {
  expect(await loadCachedSandbox(null)).toBeNull()
  expect(internalRead).not.toHaveBeenCalled()
})

test('a scanned skill knows both its source and the hash of its bundle', () => {
  const source = sandboxSourceOf(skillScan(), null, `0x${'0'.repeat(64)}`)
  expect(source).toEqual({ src: `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`, bundleHash: BUNDLE })
})

test('a contract has no bundle to run', () => {
  expect(sandboxSourceOf(null, '0x60b9262456de011f7d15a54cdd8c48baaa8b022f', `0x${'22'.repeat(32)}`)).toBeNull()
})

test('a skill without a scan and without a pinned hash has nothing to run', () => {
  expect(sandboxSourceOf(null, `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`, `0x${'0'.repeat(64)}`)).toBeNull()
})
