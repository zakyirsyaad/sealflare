import { expect, test } from 'vitest'
import { targetIdOfContract } from '@sealflare/shared/rules'
import {
  account,
  addresses,
  applyVerdict,
  attest,
  chainClient,
  coreContract,
  createTestDb,
  markDisputed,
  probeBytecode,
  settle,
  sponsor,
  targetAddress,
} from './helpers'
import { FatalIndexError } from '../src/fatal'
import { indexOnce } from '../src/loop'

const core = () => addresses().core

/** The chain is shared by the whole run, so every test uses a target of its own. */
const PUBLISHER_TARGET = targetAddress(0x61)
const DELEGATECALL_TARGET = targetAddress(0x62)
const DISPUTE_TARGET = targetAddress(0x63)
const VERDICT_TARGET = targetAddress(0x64)
const SETTLE_TARGET = targetAddress(0x65)
const MISSING_TARGET = targetAddress(0x66)

test('a bound publisher is stored with the role the contract gave it', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOfContract(PUBLISHER_TARGET)
  await attest({ from: 0, contract: PUBLISHER_TARGET })
  await sponsor({ from: 0, targetId })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ publisher: string; publisher_role: string }>(
    'SELECT publisher, publisher_role FROM targets WHERE target_id = $1',
    [targetId],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.publisher).toBe(account(0).address.toLowerCase())
  expect(rows[0]?.publisher_role).toBe('THIRD_PARTY_SPONSOR')

  const onChain = await coreContract().read.getTarget([targetId])
  expect(onChain.publisher.toLowerCase()).toBe(rows[0]?.publisher)
  expect(onChain.publisherRole).toBe(1)
  await close()
})

test('a target flagged for delegatecall says so, and the flags are the ones the contract holds', async () => {
  const { db, close } = await createTestDb()
  await probeBytecode({ from: 0, target: DELEGATECALL_TARGET })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ has_delegatecall: boolean }>(
    'SELECT has_delegatecall FROM targets WHERE src = $1',
    [DELEGATECALL_TARGET],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.has_delegatecall).toBe(true)

  const onChain = await coreContract().read.verifyContract([DELEGATECALL_TARGET])
  expect(onChain[1]).toBe(true)
  await close()
})

test('an open dispute is stored with its challenge id', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOfContract(DISPUTE_TARGET)
  await attest({ from: 0, contract: DISPUTE_TARGET })
  await markDisputed({ from: 0, targetId, challengeId: 77n })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ active_challenge_id: string | null }>(
    'SELECT active_challenge_id FROM targets WHERE target_id = $1',
    [targetId],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.active_challenge_id).toBe('77')

  const onChain = await coreContract().read.getTarget([targetId])
  expect(onChain.activeChallengeId).toBe(77n)
  await close()
})

test('an upheld verdict confirms the danger and adds the flags of the verdict', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOfContract(VERDICT_TARGET)
  // A DANGER vote puts flag 1 on the target, the verdict puts flag 4 on it.
  await attest({ from: 0, contract: VERDICT_TARGET, verdict: 2, flags: 1 })
  await markDisputed({ from: 0, targetId, challengeId: 88n })
  await applyVerdict({ from: 0, targetId, challengeId: 88n, outcome: 1, flags: 4 })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{
    confirmed_danger: boolean
    active_flags: number
    active_challenge_id: string | null
    count_at_verdict: number | null
    verdict_at: Date | null
  }>(
    `SELECT confirmed_danger, active_flags, active_challenge_id, count_at_verdict, verdict_at
     FROM targets WHERE target_id = $1`,
    [targetId],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.confirmed_danger).toBe(true)
  expect(rows[0]?.active_flags).toBe(5)
  expect(rows[0]?.active_challenge_id).toBeNull()
  // The settlement pays a DANGER vote by its place before the verdict, so the count is kept.
  expect(rows[0]?.count_at_verdict).toBe(1)
  expect(rows[0]?.verdict_at).not.toBeNull()

  const onChain = await coreContract().read.getTarget([targetId])
  expect(onChain.confirmedDanger).toBe(true)
  expect(onChain.activeFlags).toBe(5)
  await close()
})

test('a settled attestation is marked as settled, and the guardian gets the score', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOfContract(SETTLE_TARGET)
  const guardian = account(0).address
  await attest({ from: 0, contract: SETTLE_TARGET, verdict: 0 })
  await settle({ from: 0, targetId })

  await indexOnce({ client: chainClient(), sql: db, addresses: { core: core() } })

  const rows = await db.query<{ settled: boolean; attestation_index: number }>(
    'SELECT settled, attestation_index FROM attestations WHERE target_id = $1',
    [targetId],
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.settled).toBe(true)

  const onChain = await coreContract().read.getAttestation([targetId, 0])
  expect(onChain.settled).toBe(true)

  const score = await db.query<{ score: number }>('SELECT score FROM guardians WHERE address = $1', [
    guardian.toLowerCase(),
  ])
  const onChainScore = await coreContract().read.getGuardian([guardian])
  expect(score[0]?.score).toBe(onChainScore.score)
  await close()
})

test('an event that names a target the database does not have stops the indexer', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOfContract(MISSING_TARGET)
  await attest({ from: 0, contract: MISSING_TARGET })
  // The block that created the target is left out, so the database never learns about it.
  const sponsored = await sponsor({ from: 0, targetId })

  await expect(
    indexOnce({
      client: chainClient(),
      sql: db,
      addresses: { core: core() },
      startBlock: sponsored.blockNumber,
    }),
  ).rejects.toThrow(FatalIndexError)
  await expect(
    indexOnce({
      client: chainClient(),
      sql: db,
      addresses: { core: core() },
      startBlock: sponsored.blockNumber,
    }),
  ).rejects.toThrow(/START_BLOCK must be at or before the block of the first Core event/)

  // The range is rolled back, so the cursor stays where it was.
  expect(await db.query('SELECT * FROM cursor')).toHaveLength(0)
  expect(await db.query('SELECT * FROM targets')).toHaveLength(0)
  await close()
})
