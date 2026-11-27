import { expect, test } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, CONTRACT, GUARDIAN, GUARDIAN_B, insertTarget, targetId } from './targets.seed'
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

test('a bounty that came before its target is named by the id of the target, then by its label', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(60)
  await db.query(
    `INSERT INTO bounties (id, target_id, label, requester, slots, amount, created_at, settled, start_index)
     VALUES ('9', $1, NULL, $2, 3, 1000, '2026-11-25T10:00:00.000Z', false, 0)`,
    [id, GUARDIAN],
  )

  const before = asAnswer<{ items: { label: string }[] }>(await body(await get(app, '/bounties')))
  expect(before.data?.items[0]?.label).toBe(id)

  await insertTarget(db, { id, label: 'owner/skill' })
  const after = asAnswer<{ items: { label: string }[] }>(await body(await get(app, '/bounties')))
  expect(after.data?.items[0]?.label).toBe('owner/skill')
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

test('the open bounties are the ones that can still be filled', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(66)
  await insertTarget(db, { id })
  // An open bounty: it still has a slot left.
  await insertBounty(db, { id: '10', targetId: id, requester: GUARDIAN, slots: 3 })
  // A full bounty: every slot is filled.
  await insertBounty(db, { id: '11', targetId: id, requester: GUARDIAN_B, slots: 3 })
  await insertFiller(db, { bountyId: '11', guardian: GUARDIAN })
  await insertFiller(db, { bountyId: '11', guardian: GUARDIAN_B })
  await insertFiller(db, { bountyId: '11', guardian: CONTRACT })
  // A settled bounty.
  await insertBounty(db, { id: '12', targetId: id, requester: GUARDIAN, settled: true })

  const answer = asAnswer<{ items: { id: string }[] }>(await body(await get(app, '/bounties?open=true')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items.map((item) => item.id)).toEqual(['10'])
  // The total of the page is the total of the open bounties, so the pager agrees with the rows.
  expect(answer.meta?.page).toEqual({ total: 1, page: 1, limit: 20 })
  await close()
})

test('the bounty list without the open filter holds every bounty', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const id = targetId(67)
  await insertTarget(db, { id })
  await insertBounty(db, { id: '13', targetId: id, requester: GUARDIAN, slots: 3 })
  await insertBounty(db, { id: '14', targetId: id, requester: GUARDIAN, slots: 3 })
  await insertFiller(db, { bountyId: '14', guardian: GUARDIAN })
  await insertFiller(db, { bountyId: '14', guardian: GUARDIAN_B })
  await insertFiller(db, { bountyId: '14', guardian: CONTRACT })

  const answer = asAnswer<{ items: { id: string }[] }>(await body(await get(app, '/bounties')))
  expect(answer.data?.items.map((item) => item.id)).toEqual(['14', '13'])
  expect(answer.meta?.page).toEqual({ total: 2, page: 1, limit: 20 })
  await close()
})

test('a bounty the database does not have is not found', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const response = await get(app, '/bounties/99')
  expect(response.status).toBe(404)
  await close()
})
