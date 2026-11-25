import { expect, test } from 'vitest'
import { body, createTestDb, headers, post, testApp } from './helpers'

const KEY = 'b'.repeat(64)
const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const NOW = new Date('2026-11-25T10:00:00.000Z')

type RateAnswer = { success: true; data: { allowed: boolean; retryAfterSeconds: number } }

test('rate/take allows up to the limit in a window and then reports when to retry', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const first = await post(app, '/rate/take', { key: KEY, limit: 2, windowSeconds: 600 })
  expect(first.status).toBe(200)
  expect(await body<RateAnswer>(first)).toEqual({ success: true, data: { allowed: true, retryAfterSeconds: 0 } })

  const second = await post(app, '/rate/take', { key: KEY, limit: 2, windowSeconds: 600 })
  expect((await body<RateAnswer>(second)).data.allowed).toBe(true)

  const third = await post(app, '/rate/take', { key: KEY, limit: 2, windowSeconds: 600 })
  expect(await body<RateAnswer>(third)).toEqual({ success: true, data: { allowed: false, retryAfterSeconds: 600 } })

  await close()
})

test('a new window starts fresh', async () => {
  const { db, close } = await createTestDb()
  let clock = NOW
  const { app } = testApp(db, { now: () => clock })

  await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  const blocked = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  expect((await body<RateAnswer>(blocked)).data.allowed).toBe(false)

  clock = new Date(NOW.getTime() + 600_000)
  const next = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  expect((await body<RateAnswer>(next)).data.allowed).toBe(true)

  await close()
})

test('another key has its own count', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  const other = await post(app, '/rate/take', { key: 'c'.repeat(64), limit: 1, windowSeconds: 600 })

  expect((await body<RateAnswer>(other)).data.allowed).toBe(true)
  await close()
})

test('the key must be a hash, so a raw address never reaches the table', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/rate/take', {
    key: ADDRESS,
    limit: 1,
    windowSeconds: 60,
  })

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM rate')
  expect(rows).toHaveLength(0)
  await close()
})

test('a body that is not JSON is 400', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await app.request('/rate/take', {
    method: 'POST',
    headers: headers(),
    body: 'not json',
  })

  expect(response.status).toBe(400)
  await close()
})

test('a body that does not match the schema is 400', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/rate/take', { key: KEY, limit: 0, windowSeconds: 600 })

  expect(response.status).toBe(400)
  await close()
})

test('a window longer than an hour is refused, so cleanup can never cut a live window', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 86_400 })

  expect(response.status).toBe(400)
  await close()
})

test('of many requests at once, exactly one passes the limit', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const answers = await Promise.all(
    Array.from({ length: 8 }, () => post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })),
  )
  expect(answers.every((answer) => answer.status === 200)).toBe(true)
  const decisions = await Promise.all(answers.map((answer) => answer.json() as Promise<RateAnswer>))

  expect(decisions.filter((decision) => decision.data.allowed)).toHaveLength(1)
  const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM rate')
  expect(rows[0]?.count).toBe(1)
  await close()
})

test('the key must be a 64 character hash, so a raw address never reaches the table', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/rate/take', {
    key: ADDRESS.slice(2),
    limit: 1,
    windowSeconds: 60,
  })

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM rate')
  expect(rows).toHaveLength(0)
  await close()
})

test('a key that is not 64 hex characters is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/rate/take', { key: 'b'.repeat(32), limit: 1, windowSeconds: 60 })

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM rate')
  expect(rows).toHaveLength(0)
  await close()
})

test('two limits on the same key with a different window have their own count', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  // Both windows start at the same second, so the two rows would share a counter without the
  // window length in the key.
  const short = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  expect((await body<RateAnswer>(short)).data.allowed).toBe(true)

  const blocked = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 600 })
  expect((await body<RateAnswer>(blocked)).data.allowed).toBe(false)

  const other = await post(app, '/rate/take', { key: KEY, limit: 1, windowSeconds: 3600 })
  expect((await body<RateAnswer>(other)).data.allowed).toBe(true)

  const rows = await db.query<{ window_seconds: number }>('SELECT window_seconds FROM rate ORDER BY window_seconds')
  expect(rows.map((row) => row.window_seconds)).toEqual([600, 3600])
  await close()
})
