import { expect, test } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, GUARDIAN, GUARDIAN_B, insertTarget, targetId } from './targets.seed'
import { insertBounty, insertFiller } from './court.seed'

/**
 * The bounties the Vault brought, and the slots they filled.
 */

test('the bounty list is paged and the open bounty comes first', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(61)
  await insertTarget(db, { id })
  await insertBounty(db, { id: '1', targetId: id, requester: GUARDIAN, createdAt: '2026-11-25T10:00:00.000Z' })
  await insertBounty(db, {
    id: '2',
    targetId: id,
    requester: GUARDIAN_B,
    settled: true,
    createdAt: '2026-11-24T10:00:00.000Z',
  })

  const answer = asAnswer<{ items: { id: string; settled: boolean }[] }>(await body(await get(app, '/bounties')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items.map((item) => item.id)).toEqual(['1', '2'])
  expect(answer.meta?.page).toEqual({ total: 2, page: 1, limit: 20 })
  await close()
})

test('the bounty list can be narrowed to one target', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const first = targetId(62)
  const second = targetId(63)
  await insertTarget(db, { id: first })
  await insertTarget(db, { id: second })
  await insertBounty(db, { id: '3', targetId: first, requester: GUARDIAN })
  await insertBounty(db, { id: '4', targetId: second, requester: GUARDIAN })

  const answer = asAnswer<{ items: { id: string }[] }>(
    await body(await get(app, `/bounties?targetId=${second}`)),
  )
  expect(answer.data?.items.map((item) => item.id)).toEqual(['4'])
  await close()
})

test('the bounty detail holds the filled slots with their verdict', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(64)
  await insertTarget(db, { id })
  await insertBounty(db, { id: '5', targetId: id, requester: GUARDIAN, slots: 3, amount: '1000' })
  await insertFiller(db, { bountyId: '5', guardian: GUARDIAN_B, verdict: 'DANGER' })

  const answer = asAnswer<{
    filled: number
    slots: number
    amount: string
    settleableAt: string | null
    fillers: { guardian: string; verdict: string }[]
  }>(await body(await get(app, '/bounties/5')))
  expect(answer.success).toBe(true)
  expect(answer.data).toMatchObject({ filled: 1, slots: 3, amount: '1000' })
  expect(answer.data?.fillers).toEqual([{ guardian: GUARDIAN_B, verdict: 'DANGER' }])
  await close()
})

test('a bounty that can be settled names the moment it can be settled', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(65)
  await insertTarget(db, { id })
  await insertBounty(db, {
    id: '6',
    targetId: id,
    requester: GUARDIAN,
    settleableAt: '2026-11-26T08:00:00.000Z',
  })

  const answer = asAnswer<{ settleableAt: string | null }>(await body(await get(app, '/bounties/6')))
  expect(answer.data?.settleableAt).toBe('2026-11-26T08:00:00.000Z')
  await close()
})

test('a bounty the database does not have is not found', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const response = await get(app, '/bounties/99')
  expect(response.status).toBe(404)
  await close()
})
