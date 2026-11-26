import { expect, test } from 'vitest'
import { FLAGS } from '@sealflare/shared/rules'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import { body, createTestDb, get, testApp } from './helpers'
import {
  asAnswer,
  CONTRACT,
  CONTRACT_ID,
  GUARDIAN,
  GUARDIAN_B,
  insertCursor,
  insertTarget,
  insertVote,
  targetId,
  ZERO_HASH,
} from './targets.seed'
import type { Db } from '../src/db'

test('the list is newest vote first and paged', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(1), lastVoteAt: '2026-11-25T10:00:00.000Z' })
  await insertTarget(db, { id: targetId(2), lastVoteAt: '2026-11-25T12:00:00.000Z' })
  await insertTarget(db, { id: targetId(3), lastVoteAt: null })

  const first = asAnswer<{ items: { targetId: string }[] }>(await body(await get(app, '/targets?limit=2')))
  expect(first.success).toBe(true)
  expect(first.data?.items.map((item) => item.targetId)).toEqual([targetId(2), targetId(1)])
  expect(first.meta?.page).toEqual({ total: 3, page: 1, limit: 2 })

  const second = asAnswer<{ items: { targetId: string }[] }>(await body(await get(app, '/targets?limit=2&page=2')))
  expect(second.data?.items.map((item) => item.targetId)).toEqual([targetId(3)])
  expect(second.meta?.page).toEqual({ total: 3, page: 2, limit: 2 })
  await close()
})

test('a page past the end still names the real total', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(1) })
  await insertTarget(db, { id: targetId(2) })
  await insertTarget(db, { id: targetId(3) })

  const answer = asAnswer<{ items: unknown[] }>(await body(await get(app, '/targets?limit=2&page=9')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items).toEqual([])
  expect(answer.meta?.page).toEqual({ total: 3, page: 9, limit: 2 })
  await close()
})

test('the attestation list past the end still names the real total', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(18)
  await insertTarget(db, { id })
  await insertVote(db, { targetId: id, index: 0 })
  await insertVote(db, { targetId: id, index: 1 })

  const answer = asAnswer<{ items: unknown[] }>(
    await body(await get(app, `/targets/${id}/attestations?limit=1&page=5`)),
  )
  expect(answer.data?.items).toEqual([])
  expect(answer.meta?.page).toEqual({ total: 2, page: 5, limit: 1 })
  await close()
})

test('filters by type and by an address that attested', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const skill = targetId(4)
  await insertTarget(db, { id: targetId(5), src: CONTRACT })
  await insertTarget(db, { id: skill, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: ZERO_HASH })
  await insertVote(db, { targetId: targetId(5), index: 0, guardian: GUARDIAN })
  await insertVote(db, { targetId: skill, index: 1, guardian: GUARDIAN_B })

  const byType = asAnswer<{ items: { targetId: string }[] }>(
    await body(await get(app, '/targets?type=AI_SKILL_BUNDLE')),
  )
  expect(byType.data?.items.map((item) => item.targetId)).toEqual([skill])

  const byAddress = asAnswer<{ items: { targetId: string }[] }>(
    await body(await get(app, `/targets?address=${GUARDIAN}`)),
  )
  expect(byAddress.data?.items.map((item) => item.targetId)).toEqual([targetId(5)])
  await close()
})

test('the signal splits weight-1 votes from weight-2-and-above votes, with counts, weights and flags per group', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(6)
  await insertTarget(db, { id })
  for (let index = 0; index < 42; index += 1) {
    await insertVote(db, { targetId: id, index, weight: 1, verdict: 'SAFE' })
  }
  for (let index = 0; index < 3; index += 1) {
    await insertVote(db, { targetId: id, index: 42 + index, weight: 5, verdict: 'DANGER', flags: FLAGS.HIDDEN_MINT })
  }

  const answer = asAnswer<{
    signal: {
      newIds: { votes: { safe: number }; weight: { safe: number } }
      guardians: { votes: { danger: number }; weight: { danger: number }; flags: number }
    }
  }>(await body(await get(app, `/targets/${id}`)))

  expect(answer.data?.signal.newIds.votes.safe).toBe(42)
  expect(answer.data?.signal.newIds.weight.safe).toBe(42)
  expect(answer.data?.signal.guardians.votes.danger).toBe(3)
  expect(answer.data?.signal.guardians.weight.danger).toBe(15)
  expect(answer.data?.signal.guardians.flags).toBe(FLAGS.HIDDEN_MINT)
  await close()
})

test('every answer carries the last finalized block', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertCursor(db, 4242)
  const id = targetId(7)
  await insertTarget(db, { id })
  await insertVote(db, { targetId: id, index: 0 })

  const list = asAnswer(await body(await get(app, '/targets')))
  const detail = asAnswer(await body(await get(app, `/targets/${id}`)))
  const attestations = asAnswer(await body(await get(app, `/targets/${id}/attestations`)))
  expect(list.meta?.finalizedBlock).toBe('4242')
  expect(detail.meta?.finalizedBlock).toBe('4242')
  expect(attestations.meta?.finalizedBlock).toBe('4242')
  await close()
})

test('a detail joins the cached scan when there is one and is null otherwise', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = CONTRACT_ID
  await insertTarget(db, { id })

  const without = asAnswer<{ scan: unknown }>(await body(await get(app, `/targets/${id}`)))
  expect(without.data?.scan).toBeNull()

  const report = {
    schemaVersion: 1,
    targetType: 'SMART_CONTRACT',
    targetId: id,
    source: { kind: 'contract', address: CONTRACT, codehash: ZERO_HASH, blockNumber: '10' },
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
  }
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    id,
    CONTRACT,
    JSON.stringify(report),
    '2026-11-25T10:00:00.000Z',
  ])

  const withScan = asAnswer<{ scan: { targetId: string } | null }>(await body(await get(app, `/targets/${id}`)))
  expect(withScan.data?.scan?.targetId).toBe(id)
  await close()
})

test('the internal list and detail accept tier null before the public API fills it', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(9)
  await insertTarget(db, { id })

  const list = asAnswer<{ items: { tier: unknown }[] }>(await body(await get(app, '/targets')))
  const detail = asAnswer<{ tier: unknown }>(await body(await get(app, `/targets/${id}`)))
  expect(list.data?.items[0]?.tier).toBeNull()
  expect(detail.data?.tier).toBeNull()
  await close()
})

test('tier candidates use the same type and address filters and deterministic order as the paged list', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(10), lastVoteAt: '2026-11-25T10:00:00.000Z' })
  await insertTarget(db, { id: targetId(11), lastVoteAt: '2026-11-25T12:00:00.000Z' })
  await insertTarget(db, { id: targetId(12), type: 'AI_SKILL_BUNDLE', src: null, bundleHash: ZERO_HASH })
  await insertVote(db, { targetId: targetId(10), index: 0, guardian: GUARDIAN })

  const candidates = asAnswer<{ items: { targetId: string }[] }>(
    await body(await get(app, `/targets/tier-candidates?address=${GUARDIAN}`)),
  )
  expect(candidates.data?.items.map((item) => item.targetId)).toEqual([targetId(10)])

  const skills = asAnswer<{ items: { targetId: string }[] }>(
    await body(await get(app, '/targets/tier-candidates?type=AI_SKILL_BUNDLE')),
  )
  expect(skills.data?.items.map((item) => item.targetId)).toEqual([targetId(12)])

  const list = asAnswer<{ items: { targetId: string }[] }>(await body(await get(app, '/targets?limit=100')))
  expect(list.data?.items.map((item) => item.targetId)).toEqual([targetId(11), targetId(10), targetId(12)])
  await close()
})

test('tier candidates and finalizedBlock come from one snapshot even while the indexer advances', async () => {
  const { db, close } = await createTestDb()
  await insertCursor(db, 100)
  await insertTarget(db, { id: targetId(13) })

  // A database that refuses to answer outside a transaction. The candidates and the cursor can
  // only come from one snapshot when every read happens inside the same transaction.
  const recorded = recordingTransactionOnly(db)
  const { app } = testApp(recorded.db)

  const answer = asAnswer<{ items: unknown[] }>(await body(await get(app, '/targets/tier-candidates')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items).toHaveLength(1)
  expect(answer.meta?.finalizedBlock).toBe('100')

  // The transaction has to raise the isolation level before the first read. Without it every
  // statement sees its own snapshot and the guarantee is void.
  expect(recorded.statements[0]).toMatch(/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/)
  expect(recorded.isolation()).toBe('repeatable read')
  await close()
})

test('tier candidates return all 500 rows at the limit and a 503 for 501 matching candidates', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await db.transaction(async (tx) => {
    for (let index = 0; index < 500; index += 1) {
      await insertTarget(tx, { id: targetId(1000 + index) })
    }
  })

  const answer = asAnswer<{ items: unknown[] }>(await body(await get(app, '/targets/tier-candidates')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items).toHaveLength(500)

  await insertTarget(db, { id: targetId(2000) })
  const tooMany = asAnswer(await body(await get(app, '/targets/tier-candidates')))
  expect(tooMany.success).toBe(false)
  expect(tooMany.error?.code).toBe('INTERNAL')
  await close()
})

test('a skill indexed from TargetCreated without a cached source has src null in list and detail responses', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const skill = targetId(14)
  await insertTarget(db, { id: skill, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: ZERO_HASH })

  const list = asAnswer<{ items: { src: unknown }[] }>(await body(await get(app, '/targets')))
  const detail = asAnswer<{ src: unknown }>(await body(await get(app, `/targets/${skill}`)))
  expect(list.data?.items[0]?.src).toBeNull()
  expect(detail.data?.src).toBeNull()
  await close()
})

test('an Attested event with an empty evidence URI is returned in the attestation list', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(15)
  await insertTarget(db, { id })
  await insertVote(db, { targetId: id, index: 0, evidenceUri: '', shortProof: '0x1234' })

  const answer = asAnswer<{ items: { evidenceURI: string; shortProof: string }[] }>(
    await body(await get(app, `/targets/${id}/attestations`)),
  )
  expect(answer.data?.items).toHaveLength(1)
  expect(answer.data?.items[0]?.evidenceURI).toBe('')
  expect(answer.data?.items[0]?.shortProof).toBe('0x1234')
  await close()
})

test('an unknown target is 404, not an empty object', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await get(app, `/targets/${targetId(16)}`)
  expect(response.status).toBe(404)
  const answer = asAnswer(await body(response))
  expect(answer.success).toBe(false)
  expect(answer.error?.code).toBe('NOT_FOUND')
  await close()
})

test('limit above 100 is rejected', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await get(app, '/targets?limit=101')
  expect(response.status).toBe(400)
  const answer = asAnswer(await body(response))
  expect(answer.success).toBe(false)
  expect(answer.error?.code).toBe('BAD_REQUEST')
  await close()
})

test('a target whose source does not match its type is refused, not answered', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  // A contract target with a skill reference. The frozen read model refuses it.
  await insertTarget(db, { id: targetId(17), src: `gh:owner/repo@${'a'.repeat(40)}:skill` })

  const response = await get(app, '/targets')
  expect(response.status).toBe(500)
  const answer = asAnswer(await body(response))
  expect(answer.success).toBe(false)
  expect(answer.error?.code).toBe('INTERNAL')
  await close()
})

test('a skill whose row holds a bundle hash is answered with no source', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const skill = targetId(20)
  // The bundle hash is not a source. The read model does not take the source of a skill from
  // the column, so one row like this cannot take the whole list down.
  await insertTarget(db, { id: skill, type: 'AI_SKILL_BUNDLE', src: ZERO_HASH, bundleHash: ZERO_HASH })

  const response = await get(app, '/targets')
  expect(response.status).toBe(200)
  const list = asAnswer<{ items: { src: unknown }[] }>(await body(response))
  expect(list.data?.items[0]?.src).toBeNull()
  await close()
})

test('a skill with a cached scan shows the pinned reference in the list and the detail', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const contentHash = `0x${'2'.repeat(64)}` as `0x${string}`
  const publisher = '0x3333333333333333333333333333333333333333' as `0x${string}`
  const canonical = canonicalBundleHash(contentHash, publisher)
  const id = targetIdOfSkill(canonical)
  await insertTarget(db, { id, type: 'AI_SKILL_BUNDLE', src: null, bundleHash: canonical })
  await db.query(`INSERT INTO scan_cache (target_id, src, report, scanned_at) VALUES ($1, $2, $3, $4)`, [
    id,
    'gh:owner/repo@' + 'a'.repeat(40) + ':skill',
    JSON.stringify({
      schemaVersion: 1,
      targetType: 'AI_SKILL_BUNDLE',
      targetId: id,
      source: {
        kind: 'skill',
        repo: 'owner/repo',
        commit: 'a'.repeat(40),
        path: 'skill',
        contentHash,
        manifestPublisher: publisher,
        canonicalBundleHash: canonical,
        fileCount: 1,
        totalBytes: 10,
      },
      scannedAt: '2026-11-25T10:00:00.000Z',
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
    }),
    '2026-11-25T10:00:00.000Z',
  ])

  const expected = `gh:owner/repo@${'a'.repeat(40)}:skill`
  const list = asAnswer<{ items: { src: unknown }[] }>(await body(await get(app, '/targets')))
  expect(list.data?.items[0]?.src).toBe(expected)
  const detail = asAnswer<{ src: unknown }>(await body(await get(app, `/targets/${id}`)))
  expect(detail.data?.src).toBe(expected)
  await close()
})

test('a vote that does not fit the read model is refused, not answered', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(19)
  await insertTarget(db, { id })
  // A guardian that is not an address. The frozen read model refuses it.
  await insertVote(db, { targetId: id, index: 0, guardian: 'not-an-address' })

  const response = await get(app, `/targets/${id}/attestations`)
  expect(response.status).toBe(500)
  const answer = asAnswer(await body(response))
  expect(answer.success).toBe(false)
  expect(answer.error?.code).toBe('INTERNAL')
  await close()
})

/** A database that only answers inside a transaction, and that records what it was asked. */
function recordingTransactionOnly(db: Db): {
  db: Db
  statements: string[]
  isolation: () => string | null
} {
  const statements: string[] = []
  let isolation: string | null = null
  let depth = 0
  const wrapped: Db = {
    query: (text, params) => {
      if (depth === 0) throw new Error('a query ran outside the transaction')
      return db.query(text, params)
    },
    exec: (text) => {
      if (depth === 0) throw new Error('a statement ran outside the transaction')
      return db.exec(text)
    },
    transaction: async (fn) => {
      depth += 1
      try {
        return await db.transaction((tx) =>
          fn({
            query: async <T,>(text: string, params?: readonly unknown[]): Promise<T[]> => {
              statements.push(text)
              const rows = await tx.query<T>(text, params)
              if (/^\s*SET TRANSACTION/i.test(text)) {
                const level = await tx.query<{ transaction_isolation: string }>('SHOW transaction_isolation')
                isolation = level[0]?.transaction_isolation ?? null
              }
              return rows
            },
            exec: (text) => tx.exec(text),
            transaction: async () => {
              throw new Error('a transaction cannot start inside a transaction')
            },
          }),
        )
      } finally {
        depth -= 1
      }
    },
  }
  return { db: wrapped, statements, isolation: () => isolation }
}
