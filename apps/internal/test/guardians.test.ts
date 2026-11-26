import { expect, test } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, GUARDIAN, GUARDIAN_B, insertTarget, insertVote, targetId } from './targets.seed'
import { insertGuardian } from './court.seed'

/**
 * The guardians the Core knows, and the penalty that is still waiting to be charged.
 */

test('the guardian list is paged and the guardians with the same score come first by their votes', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertGuardian(db, { address: GUARDIAN, attestations: 2 })
  await insertGuardian(db, { address: GUARDIAN_B, attestations: 7 })

  const answer = asAnswer<{ items: { address: string }[] }>(await body(await get(app, '/guardians?limit=1')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items.map((item) => item.address)).toEqual([GUARDIAN_B])
  expect(answer.meta?.page).toEqual({ total: 2, page: 1, limit: 1 })
  await close()
})

test('the guardians come first by the score of the chain, not by the number of votes', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertGuardian(db, { address: GUARDIAN, score: 5, attestations: 9 })
  await insertGuardian(db, { address: GUARDIAN_B, score: 40, attestations: 1 })

  const answer = asAnswer<{ items: { address: string }[] }>(await body(await get(app, '/guardians')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items.map((item) => item.address)).toEqual([GUARDIAN_B, GUARDIAN])
  await close()
})

test('a guardian with an unapplied -15 is marked penaltyPending', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertGuardian(db, { address: GUARDIAN, score: 20, weight: 2, attestations: 4, pendingPenalties: 1 })
  await insertGuardian(db, { address: GUARDIAN_B, score: 30, weight: 3, attestations: 9, pendingPenalties: 0 })

  const answer = asAnswer<{ items: { address: string; penaltyPending: boolean }[] }>(
    await body(await get(app, '/guardians')),
  )
  const byAddress = new Map(answer.data?.items.map((item) => [item.address, item.penaltyPending]))
  expect(byAddress.get(GUARDIAN)).toBe(true)
  expect(byAddress.get(GUARDIAN_B)).toBe(false)
  await close()
})

test('the guardian detail holds the history and the block the guardian was created in', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(41)
  await insertTarget(db, { id, label: 'The target' })
  await insertVote(db, { targetId: id, index: 0, guardian: GUARDIAN, at: '2026-11-25T10:00:00.000Z' })
  await insertGuardian(db, { address: GUARDIAN, score: 12, weight: 2, attestations: 1, createdAtBlock: 42 })

  const answer = asAnswer<{
    address: string
    score: number
    weight: number
    createdAtBlock: string
    history: { kind: string; targetId: string }[]
  }>(await body(await get(app, `/guardians/${GUARDIAN}`)))
  expect(answer.success).toBe(true)
  expect(answer.data).toMatchObject({ address: GUARDIAN, score: 12, weight: 2, createdAtBlock: '42' })
  expect(answer.data?.history[0]).toMatchObject({ kind: 'attestation', targetId: id })
  await close()
})

test('a guardian the chain does not know is not found', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const response = await get(app, `/guardians/${GUARDIAN}`)
  expect(response.status).toBe(404)
  const answer = asAnswer<{ error: { code: string } }>(await body(response))
  expect(answer.error?.code).toBe('NOT_FOUND')
  await close()
})

test('an address that is not an address is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const response = await get(app, '/guardians/not-an-address')
  expect(response.status).toBe(400)
  await close()
})
