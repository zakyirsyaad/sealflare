import { expect, test } from 'vitest'
import { keysMatch } from '../src/auth'
import { countingDb, createTestDb, post, testApp, TEST_KEY } from './helpers'

const RATE_BODY = { key: 'a'.repeat(64), limit: 1, windowSeconds: 60 }

test('a request without the inter-service key is 401 and reads nothing', async () => {
  const { db, close } = await createTestDb()
  const counted = countingDb(db)
  const { app } = testApp(counted.db)

  const response = await post(app, '/rate/take', RATE_BODY, null)

  expect(response.status).toBe(401)
  expect(counted.calls()).toBe(0)
  await close()
})

test('a request with the wrong key is 401 and reads nothing', async () => {
  const { db, close } = await createTestDb()
  const counted = countingDb(db)
  const { app } = testApp(counted.db)

  const response = await post(app, '/rate/take', RATE_BODY, 'wrong-key-that-is-long-enough-to-pass-the-length-check')

  expect(response.status).toBe(401)
  expect(counted.calls()).toBe(0)
  await close()
})

test('the key is never echoed in the answer', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const offered = 'offered-key-that-should-never-appear-in-an-answer'

  const response = await post(app, '/rate/take', RATE_BODY, offered)
  const text = await response.text()

  expect(response.status).toBe(401)
  expect(text).not.toContain(offered)
  expect(text).not.toContain(TEST_KEY)
  await close()
})

test('the key is compared in constant time, whatever its length', () => {
  expect(keysMatch(TEST_KEY, TEST_KEY)).toBe(true)
  expect(keysMatch('short', TEST_KEY)).toBe(false)
  expect(keysMatch(`${TEST_KEY}-extra`, TEST_KEY)).toBe(false)
  expect(keysMatch('', TEST_KEY)).toBe(false)
})

test('a request with the right key reaches the route', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await post(app, '/rate/take', RATE_BODY)

  expect(response.status).toBe(200)
  await close()
})

test('the health check needs no key and reads nothing', async () => {
  const { db, close } = await createTestDb()
  const counted = countingDb(db)
  const { app } = testApp(counted.db)

  const response = await app.request('/health')

  expect(response.status).toBe(200)
  expect(counted.calls()).toBe(0)
  await close()
})
