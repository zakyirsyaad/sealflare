import { expect, test } from 'vitest'
import type { Address } from 'viem'
import { account, addresses, adjustScore, attest, chainClient, coreContract, createTestDb, targetAddress } from './helpers'
import { indexOnce } from '../src/loop'

const core = () => addresses().core

/**
 * The chain is shared by the whole run, so every test votes on a target of its own and reads only
 * the rows of that target.
 */
const FIRST = targetAddress(0x21)
const THIRD = targetAddress(0x23)
const FOURTH = targetAddress(0x24)

test('an attestation becomes a row with its frozen weight, both ordinals and its short proof', async () => {
  const { db, close } = await createTestDb()
  const guardian = account(0).address.toLowerCase()
  await attest({ from: 0, contract: FIRST, verdict: 0, shortProof: '0x554e4558', evidenceURI: 'ipfs://proof' })
  await attest({ from: 1, contract: FIRST, verdict: 0 })

  const result = await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  expect(result.events).toBeGreaterThan(0)

  const rows = await db.query<{
    guardian: string
    verdict: string
    weight: number
    attestation_index: number
    safe_ordinal: number
    short_proof: string
    evidence_uri: string
  }>(
    `SELECT guardian, verdict, weight, attestation_index, safe_ordinal, short_proof, evidence_uri
     FROM attestations WHERE target_id = (SELECT target_id FROM targets WHERE src = $1)
     ORDER BY attestation_index`,
    [FIRST],
  )

  expect(rows).toHaveLength(2)
  expect(rows[0]?.guardian).toBe(guardian)
  expect(rows[0]?.verdict).toBe('SAFE')
  expect(rows[0]?.weight).toBe(1)
  expect(rows[0]?.attestation_index).toBe(0)
  expect(rows[0]?.safe_ordinal).toBe(1)
  // The proof is bytes on chain and text in the row.
  expect(rows[0]?.short_proof).toBe('UNEX')
  expect(rows[0]?.evidence_uri).toBe('ipfs://proof')
  expect(rows[1]?.attestation_index).toBe(1)
  expect(rows[1]?.safe_ordinal).toBe(2)
  await close()
})

test('indexes a skill TargetCreated event without a cached GitHub source', async () => {
  const { db, close } = await createTestDb()
  const bundleHash = `0x${'ab'.repeat(32)}` as const
  await attest({ from: 0, skill: bundleHash })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ target_type: string; src: string | null; bundle_hash: string | null }>(
    'SELECT target_type, src, bundle_hash FROM targets WHERE bundle_hash = $1',
    [bundleHash],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.target_type).toBe('AI_SKILL_BUNDLE')
  expect(rows[0]?.src).toBeNull()
  expect(rows[0]?.bundle_hash).toBe(bundleHash)
  await close()
})

test('keeps the Attested row when the emitted evidence URI is empty', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: THIRD, evidenceURI: '' })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ evidence_uri: string }>(
    'SELECT evidence_uri FROM attestations WHERE target_id = (SELECT target_id FROM targets WHERE src = $1)',
    [THIRD],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.evidence_uri).toBe('')
  await close()
})

test('target counters equal the sum of their attestation rows', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: FOURTH, verdict: 0 })
  await attest({ from: 1, contract: FOURTH, verdict: 0 })
  await attest({ from: 2, contract: FOURTH, verdict: 2, flags: 1 })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const counted = await db.query<{ safe_count: number; caution_count: number; danger_count: number }>(
    'SELECT safe_count, caution_count, danger_count FROM targets WHERE src = $1',
    [FOURTH],
  )
  const votes = await db.query<{ safe: number; caution: number; danger: number }>(
    `SELECT
       count(*) FILTER (WHERE verdict = 'SAFE')::int AS safe,
       count(*) FILTER (WHERE verdict = 'CAUTION')::int AS caution,
       count(*) FILTER (WHERE verdict = 'DANGER')::int AS danger
     FROM attestations WHERE target_id = (SELECT target_id FROM targets WHERE src = $1)`,
    [FOURTH],
  )
  expect(counted[0]?.safe_count).toBe(votes[0]?.safe)
  expect(counted[0]?.caution_count).toBe(votes[0]?.caution)
  expect(counted[0]?.danger_count).toBe(votes[0]?.danger)
  expect(votes[0]?.safe).toBe(2)
  expect(votes[0]?.danger).toBe(1)
  await close()
})

test('ScoreChanged rows add up to the guardian score Core reports', async () => {
  const { db, close } = await createTestDb()
  // A guardian of its own, so the score of the chain that the other tests share cannot land here.
  const guardian = account(2).address
  const targetId = `0x${'0'.repeat(64)}` as const
  await adjustScore({ from: 0, guardian, targetId, delta: 12 })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ delta: number }>('SELECT delta FROM score_changes WHERE guardian = $1', [
    guardian.toLowerCase(),
  ])
  const sum = rows.reduce((total, row) => total + row.delta, 0)
  const guardianRow = await db.query<{ score: number }>('SELECT score FROM guardians WHERE address = $1', [
    guardian.toLowerCase(),
  ])
  const onChain = await coreContract().read.getGuardian([guardian])
  expect(sum).toBe(12)
  expect(guardianRow[0]?.score).toBe(onChain.score)
  await close()
})

test('guardians.attestations counts every vote and equals what Core reports', async () => {
  const { db, close } = await createTestDb()
  const voter = account(2)
  await attest({ from: 2, contract: targetAddress(0x51) })
  await attest({ from: 2, contract: targetAddress(0x52) })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const onChain = await coreContract().read.getGuardian([voter.address])
  const rows = await db.query<{ attestations: number }>('SELECT attestations FROM guardians WHERE address = $1', [
    voter.address.toLowerCase(),
  ])
  expect(rows[0]?.attestations).toBeGreaterThanOrEqual(2)
  expect(rows[0]?.attestations).toBe(onChain.attestationCount)
  await close()
})

test('a NUL character in the evidence URI does not stop the indexer and is stored as a replacement', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: targetAddress(0x53), evidenceURI: 'ipfs://before\u0000after' })
  await attest({ from: 1, contract: targetAddress(0x54), evidenceURI: 'ipfs://later' })

  // One Agent ID holder can put a NUL in the calldata. The range must still be written.
  const result = await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })
  expect(result.events).toBeGreaterThan(0)

  const rows = await db.query<{ src: string; evidence_uri: string }>(
    `SELECT t.src, a.evidence_uri FROM attestations a JOIN targets t USING (target_id)
     WHERE t.src IN ($1, $2) ORDER BY t.src`,
    [targetAddress(0x53), targetAddress(0x54)],
  )
  expect(rows.map((row) => row.evidence_uri)).toEqual(['ipfs://before\uFFFDafter', 'ipfs://later'])
  expect(await db.query('SELECT * FROM cursor')).toHaveLength(1)
  await close()
})
