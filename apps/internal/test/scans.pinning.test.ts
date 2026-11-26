import { expect, test } from 'vitest'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import { body, createTestDb, get, put, testApp } from './helpers'
import { asAnswer, insertTarget } from './targets.seed'

/**
 * The source of a skill is pinned with the first scan made after its publisher is bound.
 *
 * The target id of a skill binds the content and the publisher, not the repository, so a copy of
 * the folder in another repository is the same target. The copy never takes the place of the
 * pinned repository in the source of the target, but its report still refreshes the cache.
 */

const CONTENT_HASH = `0x${'2'.repeat(64)}` as `0x${string}`
const PUBLISHER = '0x3333333333333333333333333333333333333333' as `0x${string}`
const CANONICAL = canonicalBundleHash(CONTENT_HASH, PUBLISHER)
const TARGET_ID = targetIdOfSkill(CANONICAL)

const ALICE = 'alice/skill'
const MALLORY = 'mallory/skill'
const COMMIT = 'a'.repeat(40)
const PATH = 'skill'

/** The target row the indexer writes for a skill, with its publisher bound or not. */
async function seedSkill(db: Parameters<typeof insertTarget>[0], bound: boolean): Promise<void> {
  await insertTarget(db, {
    id: TARGET_ID,
    type: 'AI_SKILL_BUNDLE',
    src: null,
    codehash: null,
    bundleHash: CANONICAL,
    publisher: bound ? PUBLISHER : null,
    publisherRole: bound ? 'VERIFIED_PUBLISHER' : 'NONE',
  })
}

async function pinnedSrc(db: Parameters<typeof insertTarget>[0]): Promise<string | null | undefined> {
  const rows = await db.query<{ src: string | null }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  return rows[0] ? rows[0].src : undefined
}

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
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  await close()
})

test('a copy of the folder in another repository does not replace the pinned source', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  await close()
})

test('a new commit of the same repository refreshes the scan', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(`gh:${ALICE}@${'b'.repeat(40)}:${PATH}`)
  await close()
})

test('the answer of a scan of a copy is still the report of the caller', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  const response = await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  expect(response.status).toBe(200)
  const answer = asAnswer<{ source: { repo: string } }>(await body(response))
  expect(answer.data?.source.repo).toBe(MALLORY)
  await close()
})

test('a newer report of a copy refreshes the report but keeps the pinned source', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  expect(await pinnedSrc(db)).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  const response = await get(app, `/scans/${TARGET_ID}`)
  const answer = asAnswer<{ scannedAt: string }>(await body(response))
  expect(answer.data?.scannedAt).toBe('2026-11-25T12:00:00.000Z')
  await close()
})

test('an older report of a copy does not replace a newer report', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T12:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T10:00:00.000Z'))

  const response = await get(app, `/scans/${TARGET_ID}`)
  const answer = asAnswer<{ source: { repo: string } }>(await body(response))
  expect(answer.data?.source.repo).toBe(ALICE)
  await close()
})

test('a scan before the publisher is bound caches the report but pins no source', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, false)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T10:00:00.000Z'))

  expect(await pinnedSrc(db)).toBeNull()
  expect((await get(app, `/scans/${TARGET_ID}`)).status).toBe(200)
  await close()
})

test('the first scan after the bind pins the source, whatever was scanned before it', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, false)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T10:00:00.000Z'))
  await db.query('UPDATE targets SET publisher = $2, publisher_role = $3 WHERE target_id = $1', [
    TARGET_ID,
    PUBLISHER,
    'VERIFIED_PUBLISHER',
  ])
  await put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T12:00:00.000Z'))

  expect(await pinnedSrc(db)).toBe(`gh:${ALICE}@${COMMIT}:${PATH}`)
  await close()
})

test('the casing of the owner and repository does not make a second repository', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, skillReport('Alice/Skill', COMMIT, '2026-11-25T10:00:00.000Z'))
  await put(app, `/scans/${TARGET_ID}`, skillReport('alice/skill', 'b'.repeat(40), '2026-11-25T12:00:00.000Z'))

  expect(await pinnedSrc(db)).toBe(`gh:alice/skill@${'b'.repeat(40)}:${PATH}`)
  await close()
})

test('two first scans of different repositories pin exactly one of them', async () => {
  const { db, close } = await createTestDb()
  await seedSkill(db, true)
  const { app } = testApp(db)

  await Promise.all([
    put(app, `/scans/${TARGET_ID}`, skillReport(ALICE, COMMIT, '2026-11-25T10:00:00.000Z')),
    put(app, `/scans/${TARGET_ID}`, skillReport(MALLORY, 'b'.repeat(40), '2026-11-25T10:00:01.000Z')),
  ])

  const pinned = await pinnedSrc(db)
  expect([`gh:${ALICE}@${COMMIT}:${PATH}`, `gh:${MALLORY}@${'b'.repeat(40)}:${PATH}`]).toContain(pinned)
  const rows = await db.query<{ report: { source: { repo: string } } }>(
    'SELECT report FROM scan_cache WHERE target_id = $1',
    [TARGET_ID],
  )
  expect(rows).toHaveLength(1)
  await close()
})
