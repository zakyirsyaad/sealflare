import { expect, test } from 'vitest'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import { body, createTestDb, get, put, testApp } from './helpers'
import { asAnswer } from './targets.seed'

/**
 * The source of a skill is pinned with the first scan.
 *
 * The target id of a skill binds the content and the publisher, not the repository, so a copy of
 * the folder in another repository is the same target. The copy never takes the place of the
 * publisher's repository in the source of the target.
 */

const CONTENT_HASH = `0x${'2'.repeat(64)}` as `0x${string}`
const PUBLISHER = '0x3333333333333333333333333333333333333333' as `0x${string}`
const CANONICAL = canonicalBundleHash(CONTENT_HASH, PUBLISHER)
const TARGET_ID = targetIdOfSkill(CANONICAL)

const ALICE = 'alice/skill'
const MALLORY = 'mallory/skill'
const COMMIT = 'a'.repeat(40)
const PATH = 'skill'

/** A scan report of the skill above, scanned from the given repository. */
function skillReport(repo: string, commit: string, scannedAt: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: TARGET_ID,
    source: {
      kind: 'skill',
      repo,
      commit,
      path: PATH,
      contentHash: CONTENT_HASH,
      manifestPublisher: PUBLISHER,
      canonicalBundleHash: CANONICAL,
      fileCount: 1,
      totalBytes: 10,
    },
    scannedAt,
    checks: [
      { id: 'bundle_hash', status: 'passed' },
      { id: 'zero_width_unicode', status: 'passed' },
      { id: 'unlimited_approval', status: 'passed' },
      { id: 'hardcoded_transfer', status: 'passed' },
      { id: 'pipe_to_shell', status: 'passed' },
      { id: 'external_dependency', status: 'passed' },
      { id: 'helper_scripts', status: 'passed' },
    ],
    findings: [],
    flags: 0,
    suggestedVerdict: 'SAFE',
  }
}

test('the first scan pins the repository of a skill', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  await close()
})

test('a copy of the folder in another repository does not replace the pinned source', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  await close()
})

test('a new commit of the same repository refreshes the scan', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${'b'.repeat(40)}:${PATH}`)
  await close()
})

test('the answer of a scan of a copy is still the report of the caller', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  const response = await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  expect(response.status).toBe(200)
  const answer = asAnswer<{ source: { repo: string } }>(await body(response))
  expect(answer.data?.source.repo).toBe(MALLORY)
  await close()
})

test('a copy of the folder does not take the place of the publisher in the cached report', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  const response = await get(app, `/scans/${TARGET_ID}`)
  const answer = asAnswer<{ source: { repo: string } }>(await body(response))
  expect(answer.data?.source.repo).toBe(ALICE)
  await close()
})
