import { afterEach, expect, test, vi } from 'vitest'
import { bundleIdentity, CONSTANTS, FLAGS } from '@sealflare/shared/rules'
import { ScanError, ScanReport, SKILL_CHECK_IDS, type RepoFetcher } from '@sealflare/shared/schemas'
import { scanSkill } from '../src/skill/scanSkill'
import * as approval from '../src/skill/checks/unlimitedApproval'
import { file, loadSkill } from './skill.fixtures'

const COMMIT = 'a'.repeat(40)
const ref = { owner: 'example', repo: 'fixture' }
const repoFor = (folder: string, folders = ['skill']): RepoFetcher => ({
  listSkillFolders: async () => ({ commit: COMMIT, folders }),
  fetchBundle: async () => loadSkill(folder),
})
afterEach(() => vi.restoreAllMocks())
test('returns a schema-valid SAFE report with every skill check exactly once', async () => {
  const report = await scanSkill(ref, { repo: repoFor('clean'), now: () => new Date('2026-11-22T00:00:00Z') })
  expect(ScanReport.safeParse(report).success).toBe(true)
  expect(report.checks.map((c) => c.id).sort()).toEqual([...SKILL_CHECK_IDS].sort())
  expect(report.suggestedVerdict).toBe('SAFE')
  expect(report.scannedAt).toBe('2026-11-22T00:00:00.000Z')
})
test('identity comes from frozen bundleIdentity and uses the resolved commit and folder', async () => {
  const report = await scanSkill(ref, { repo: repoFor('clean') })
  const { targetId, ...identity } = bundleIdentity(loadSkill('clean'))
  expect(report.targetId).toBe(targetId)
  expect(report.source).toMatchObject({ kind: 'skill', ...identity, repo: 'example/fixture', path: 'skill', commit: COMMIT })
})
test('dangerous flags are the union of findings; mutable dependency alone is CAUTION', async () => {
  const report = await scanSkill(ref, { repo: repoFor('pipe-to-shell') })
  expect(report.suggestedVerdict).toBe('DANGER')
  expect(report.flags).toBe(FLAGS.TROJAN_HELPER_SCRIPT)
  expect((await scanSkill(ref, { repo: repoFor('mutable-url') })).suggestedVerdict).toBe('CAUTION')
})
test.each([[[], 'NO_SKILL_FOUND'], [['a', 'b'], 'MULTIPLE_SKILL_FOLDERS']] as const)(
  'listing %j throws %s', async (folders, code) => {
    await expect(scanSkill(ref, { repo: repoFor('clean', [...folders]) })).rejects.toMatchObject({ code })
  })
test('multiple folders are returned as error details', async () => {
  await expect(scanSkill(ref, { repo: repoFor('clean', ['a', 'b']) })).rejects.toMatchObject({ details: { folders: ['a', 'b'] } })
})
test('an explicit root path with a pinned commit skips discovery', async () => {
  const repo: RepoFetcher = { listSkillFolders: async () => { throw Error('unexpected discovery') },
    fetchBundle: async (value) => { expect(value).toEqual({ ...ref, commit: COMMIT, path: '' }); return loadSkill('clean') } }
  expect((await scanSkill({ ...ref, commit: COMMIT, path: '' }, { repo })).suggestedVerdict).toBe('SAFE')
})
test('an explicit path without a commit resolves the commit even with multiple folders', async () => {
  expect((await scanSkill({ ...ref, path: 'a' }, { repo: repoFor('clean', ['a', 'b']) })).source).toMatchObject({ commit: COMMIT, path: 'a' })
})
test.each(['files', 'bytes'] as const)('rejects bundles above the %s limit without truncation', async (limit) => {
  const repo = repoFor('clean')
  repo.fetchBundle = async () => limit === 'files' ? Array.from({ length: CONSTANTS.MAX_BUNDLE_FILES + 1 }, (_, i) => file(`${i}`, ''))
    : [{ ...file('SKILL.md', ''), bytes: new Uint8Array(CONSTANTS.MAX_BUNDLE_BYTES + 1) }]
  await expect(scanSkill(ref, { repo })).rejects.toMatchObject({ code: 'BUNDLE_TOO_LARGE' })
})
test.each([[], [file('../bad', '')], [file('SKILL.md', ''), file('SKILL.md', '')], [file('other.md', '')]])(
  'invalid or missing manifest bundles produce NO_SKILL_FOUND', async (...args) => {
    const repo = repoFor('clean'); repo.fetchBundle = async () => args
    await expect(scanSkill(ref, { repo })).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
  })
test('a throwing check is failed, never SAFE, while other checks still run', async () => {
  vi.spyOn(approval, 'unlimitedApproval').mockImplementation(() => { throw Error('untrusted detail') })
  const report = await scanSkill(ref, { repo: repoFor('clean') })
  expect(report.checks.find((c) => c.id === 'unlimited_approval')).toEqual({ id: 'unlimited_approval', status: 'failed' })
  expect(report.checks).toHaveLength(SKILL_CHECK_IDS.length)
  expect(report.suggestedVerdict).toBe('CAUTION')
})
test('a failed check does not erase a severe finding', async () => {
  vi.spyOn(approval, 'unlimitedApproval').mockImplementation(() => { throw Error('failure') })
  expect((await scanSkill(ref, { repo: repoFor('pipe-to-shell') })).suggestedVerdict).toBe('DANGER')
})
test('adapter ScanErrors are preserved', async () => {
  const error = new ScanError('REPO_NOT_PUBLIC', 'Repository unavailable.')
  const repo = repoFor('clean'); repo.listSkillFolders = async () => { throw error }
  await expect(scanSkill(ref, { repo })).rejects.toBe(error)
})
test.each([{ ...ref, path: '../bad' }, { ...ref, commit: 'main' }, { owner: '..', repo: 'fixture' }])(
  'rejects invalid references before I/O', async (input) => {
    const repo = repoFor('clean'); repo.fetchBundle = async () => { throw Error('unexpected I/O') }
    await expect(scanSkill(input, { repo })).rejects.toMatchObject({ code: 'INPUT_NOT_RECOGNIZED' })
  })

test('binary helpers make text checks incomplete rather than SAFE', async () => {
  const repo = repoFor('clean')
  repo.fetchBundle = async () => [...loadSkill('clean'), { path: 'opaque.bin', kind: 'file', bytes: Uint8Array.of(255) }]
  const report = await scanSkill(ref, { repo })
  expect(report.suggestedVerdict).toBe('CAUTION')
  expect(report.checks.filter((check) => check.status === 'skipped')).toHaveLength(6)
})
test('the root manifest must be a regular file, never a symlink', async () => {
  const repo = repoFor('clean'); repo.fetchBundle = async () => [{ ...file('SKILL.md', 'outside'), kind: 'symlink' }]
  await expect(scanSkill(ref, { repo })).rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
})
test.each(['TOO_LARGE', 'TOO_MANY_FILES', 'INVALID_PATH'] as const)(
  'BundleError %s from an adapter is mapped to a ScanError', async (code) => {
    const { BundleError } = await import('@sealflare/shared/rules')
    const repo = repoFor('clean'); repo.fetchBundle = async () => { throw new BundleError(code, 'unsafe detail') }
    await expect(scanSkill(ref, { repo })).rejects.toBeInstanceOf(ScanError)
    await expect(scanSkill(ref, { repo })).rejects.toMatchObject({
      code: code === 'INVALID_PATH' ? 'NO_SKILL_FOUND' : 'BUNDLE_TOO_LARGE',
    })
  })
test('a resolved commit mismatch is rejected before fetching content', async () => {
  await expect(scanSkill({ ...ref, commit: 'b'.repeat(40) }, { repo: repoFor('clean') }))
    .rejects.toMatchObject({ code: 'NO_SKILL_FOUND' })
})
test('flags combine multiple findings without duplicate bits', async () => {
  const repo = repoFor('clean')
  repo.fetchBundle = async () => [file('SKILL.md', 'MAX_UINT256 MAX_UINT256\u200b')]
  const report = await scanSkill(ref, { repo })
  expect(report.flags).toBe(FLAGS.UNLIMITED_APPROVAL_REQUEST | FLAGS.OBFUSCATED_UNICODE_INJECTION)
  expect(report.findings).toHaveLength(3)
})
test('publisher.sig is excluded from identity size metadata by the frozen hashing rules', async () => {
  const repo = repoFor('clean')
  repo.fetchBundle = async () => [...loadSkill('clean'), file('publisher.sig', 'inert signature placeholder')]
  const report = await scanSkill(ref, { repo })
  expect(report.source).toMatchObject({ fileCount: loadSkill('clean').length,
    totalBytes: loadSkill('clean').reduce((sum, entry) => sum + entry.bytes.length, 0) })
})
