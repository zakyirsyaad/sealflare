import { expect, test } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, insertTarget, targetId } from './targets.seed'

/**
 * The query of the list routes comes from the shared schema, so the internal service and the
 * public API cannot drift apart. A filter the internal service cannot answer is refused, so the
 * caller knows the filter was not applied instead of getting the unfiltered list.
 */

test('a tier filter is refused, because the tier is read from the chain', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(1) })

  const response = await get(app, '/targets?tier=COMMUNITY_SAFE')
  expect(response.status).toBe(400)
  const answer = asAnswer(await body(response))
  expect(answer.success).toBe(false)
  expect(answer.error?.code).toBe('BAD_REQUEST')
  expect(answer.error?.message).toMatch(/tier/i)
  await close()
})

test('a tier filter is refused on the candidate route too', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(2) })

  const response = await get(app, '/targets/tier-candidates?tier=COMMUNITY_SAFE')
  expect(response.status).toBe(400)
  const answer = asAnswer(await body(response))
  expect(answer.error?.code).toBe('BAD_REQUEST')
  await close()
})

test('a query that the shared schema refuses is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const notANumber = await get(app, '/targets?page=abc')
  expect(notANumber.status).toBe(400)

  const notAType = await get(app, '/targets?type=BRIDGE')
  expect(notAType.status).toBe(400)

  const notAnAddress = await get(app, '/targets?address=0x123')
  expect(notAnAddress.status).toBe(400)

  const limitTooHigh = await get(app, '/targets?limit=101')
  expect(limitTooHigh.status).toBe(400)
  await close()
})

test('the page and the limit of the shared schema are answered', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  await insertTarget(db, { id: targetId(3), lastVoteAt: '2026-11-25T10:00:00.000Z' })
  await insertTarget(db, { id: targetId(4), lastVoteAt: '2026-11-25T12:00:00.000Z' })

  const answer = asAnswer<{ items: { targetId: string }[] }>(
    await body(await get(app, '/targets?page=1&limit=1')),
  )
  expect(answer.data?.items.map((item) => item.targetId)).toEqual([targetId(4)])
  expect(answer.meta?.page).toEqual({ total: 2, page: 1, limit: 1 })
  await close()
})
