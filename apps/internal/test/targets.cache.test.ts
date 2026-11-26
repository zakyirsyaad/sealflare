import { expect, test } from 'vitest'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import noViolation from '@sealflare/shared/fixtures/sandbox/no-violation.json'
import fuzzFailed from '@sealflare/shared/fixtures/sandbox/fuzz-failed.json'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, insertTarget, targetId, ZERO_HASH } from './targets.seed'

/**
 * The cached results of a target.
 *
 * A clean sandbox result expires when the probe set or the model changes, and the scan of a
 * contract only belongs to the target when it is the scan of the pinned bytecode.
 */

const CONTENT_HASH = `0x${'2'.repeat(64)}` as `0x${string}`
const PUBLISHER = '0x3333333333333333333333333333333333333333' as `0x${string}`
const CANONICAL = canonicalBundleHash(CONTENT_HASH, PUBLISHER)

/** The skill target of the bundle above. */
const SKILL_ID = targetIdOfSkill(CANONICAL)

/** A sandbox result of the given status, with the given version. */
function sandboxResult(status: 'clean' | 'failed', probeSetVersion: string, modelId: string): Record<string, unknown> {
  const base = status === 'clean' ? noViolation : fuzzFailed
  return {
    ...base,
    bundleHash: CANONICAL,
    probeSetVersion,
    modelId,
  }
}

async function insertSandbox(
  db: { query: <T>(text: string, params?: readonly unknown[]) => Promise<T[]> },
  status: 'NO_VIOLATION_OBSERVED' | 'SANDBOX_FUZZ_FAILED',
  probeSetVersion: string,
  modelId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO sandbox_cache (bundle_hash, probe_set_version, model_id, status, result, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      CANONICAL,
      probeSetVersion,
      modelId,
      status,
      JSON.stringify(
        sandboxResult(status === 'NO_VIOLATION_OBSERVED' ? 'clean' : 'failed', probeSetVersion, modelId),
      ),
      '2026-11-25T10:00:00.000Z',
    ],
  )
}

test('a clean sandbox result of an older probe set is not shown as current', async () => {
  const { db, close } = await createTestDb()
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })
  await insertSandbox(db, 'NO_VIOLATION_OBSERVED', 'probe-set-1', 'model-1')

  const old = asAnswer<{ sandbox: unknown }>(
    await body(await get(testApp(db, { sandboxProbeSetVersion: 'probe-set-1', sandboxModelId: 'model-1' }).app, `/targets/${SKILL_ID}`)),
  )
  expect(old.data?.sandbox).not.toBeNull()

  const newer = asAnswer<{ sandbox: unknown }>(
    await body(await get(testApp(db, { sandboxProbeSetVersion: 'probe-set-2', sandboxModelId: 'model-1' }).app, `/targets/${SKILL_ID}`)),
  )
  expect(newer.data?.sandbox).toBeNull()
  await close()
})

test('a clean sandbox result of another model is not shown as current', async () => {
  const { db, close } = await createTestDb()
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })
  await insertSandbox(db, 'NO_VIOLATION_OBSERVED', 'probe-set-1', 'model-1')

  const answer = asAnswer<{ sandbox: unknown }>(
    await body(await get(testApp(db, { sandboxProbeSetVersion: 'probe-set-1', sandboxModelId: 'model-2' }).app, `/targets/${SKILL_ID}`)),
  )
  expect(answer.data?.sandbox).toBeNull()
  await close()
})

test('a failed sandbox result is kept whatever version produced it', async () => {
  const { db, close } = await createTestDb()
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })
  await insertSandbox(db, 'SANDBOX_FUZZ_FAILED', 'probe-set-1', 'model-1')

  const answer = asAnswer<{ sandbox: { status: string } | null }>(
    await body(await get(testApp(db, { sandboxProbeSetVersion: 'probe-set-9', sandboxModelId: 'model-9' }).app, `/targets/${SKILL_ID}`)),
  )
  expect(answer.data?.sandbox?.status).toBe('SANDBOX_FUZZ_FAILED')
  await close()
})

test('without a known version no clean sandbox result is shown at all', async () => {
  const { db, close } = await createTestDb()
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })
  await insertSandbox(db, 'NO_VIOLATION_OBSERVED', 'probe-set-1', 'model-1')

  const answer = asAnswer<{ sandbox: unknown }>(await body(await get(testApp(db).app, `/targets/${SKILL_ID}`)))
  expect(answer.data?.sandbox).toBeNull()
  await close()
})

test('a scan of other bytecode at the same address is not the scan of this target', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(30)
  await insertTarget(db, { id, codehash: `0x${'3'.repeat(64)}` })
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    id,
    '0x1111111111111111111111111111111111111111',
    JSON.stringify({
      schemaVersion: 1,
      targetType: 'SMART_CONTRACT',
      targetId: id,
      source: {
        kind: 'contract',
        address: '0x1111111111111111111111111111111111111111',
        codehash: `0x${'9'.repeat(64)}`,
        blockNumber: '10',
      },
      scannedAt: '2026-11-25T10:00:00.000Z',
      checks: [
        { id: 'source_verified', status: 'passed' },
        { id: 'admin_functions', status: 'passed' },
        { id: 'proxy_eip1967', status: 'passed' },
        { id: 'proxy_beacon', status: 'passed' },
        { id: 'proxy_eip1167', status: 'passed' },
        { id: 'delegatecall_opcode', status: 'passed' },
        { id: 'dry_run', status: 'passed' },
      ],
      findings: [],
      flags: 0,
      suggestedVerdict: 'SAFE',
    }),
    '2026-11-25T10:00:00.000Z',
  ])

  const answer = asAnswer<{ scan: unknown }>(await body(await get(app, `/targets/${id}`)))
  expect(answer.data?.scan).toBeNull()
  await close()
})

test('one report that cannot be read does not take the list down', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(31) })
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    targetId(31),
    'gh:owner/repo@' + 'a'.repeat(40) + ':skill',
    JSON.stringify({ notAReport: true }),
    '2026-11-25T10:00:00.000Z',
  ])

  const response = await get(app, '/targets')
  expect(response.status).toBe(200)
  const answer = asAnswer<{ items: unknown[] }>(await body(response))
  expect(answer.data?.items).toHaveLength(1)
  await close()
})

test('a report that cannot be read is not shown as a scan of the target', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(32) })
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    targetId(32),
    'gh:owner/repo@' + 'a'.repeat(40) + ':skill',
    JSON.stringify({ notAReport: true }),
    '2026-11-25T10:00:00.000Z',
  ])

  const answer = asAnswer<{ scan: unknown }>(await body(await get(app, `/targets/${targetId(32)}`)))
  expect(answer.data?.scan).toBeNull()
  await close()
})

test('the tier candidates show the same source as the list', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    SKILL_ID,
    'gh:owner/repo@' + 'a'.repeat(40) + ':skill',
    '{}',
    '2026-11-25T10:00:00.000Z',
  ])

  const expected = `gh:owner/repo@${'a'.repeat(40)}:skill`
  const candidates = asAnswer<{ items: { src: unknown }[] }>(
    await body(await get(app, '/targets/tier-candidates')),
  )
  expect(candidates.data?.items[0]?.src).toBe(expected)
  const list = asAnswer<{ items: { src: unknown }[] }>(await body(await get(app, '/targets')))
  expect(list.data?.items[0]?.src).toBe(expected)
  await close()
})

test('the zero hash is the pinned code hash of a skill', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: SKILL_ID, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: CANONICAL })

  const answer = asAnswer<{ pinnedCodehash: string }>(await body(await get(app, `/targets/${SKILL_ID}`)))
  expect(answer.data?.pinnedCodehash).toBe(ZERO_HASH)
  await close()
})
