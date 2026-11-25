import { expect, test } from 'vitest'
import { cleanup } from '../src/db'
import { body, createTestDb, post, testApp } from './helpers'

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const NOW = new Date('2026-11-25T10:00:00.000Z')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

type NonceAnswer = { success: true; data: { fresh: boolean } }

test('nonce/use is true once and false on replay', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const request = { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) }

  const first = await post(app, '/nonce/use', request)
  expect(first.status).toBe(200)
  expect(await body<NonceAnswer>(first)).toEqual({ success: true, data: { fresh: true } })

  const second = await post(app, '/nonce/use', request)
  expect(await body<NonceAnswer>(second)).toEqual({ success: true, data: { fresh: false } })

  await close()
})

test('a nonce of another address is a different nonce', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  await post(app, '/nonce/use', { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) })
  const other = await post(app, '/nonce/use', {
    address: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    nonce: '1',
    expiry: String(NOW_SECONDS + 300),
  })

  expect((await body<NonceAnswer>(other)).data.fresh).toBe(true)
  await close()
})

test('nonce/use refuses an expiry in the past or more than 10 minutes ahead', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const past = await post(app, '/nonce/use', { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS - 1) })
  expect(past.status).toBe(400)

  const tooFar = await post(app, '/nonce/use', { address: ADDRESS, nonce: '2', expiry: String(NOW_SECONDS + 601) })
  expect(tooFar.status).toBe(400)

  const rows = await db.query('SELECT * FROM nonces')
  expect(rows).toHaveLength(0)
  await close()
})

test('an expiry of exactly ten minutes ahead is accepted', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/nonce/use', { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 600) })

  expect(response.status).toBe(200)
  expect((await body<NonceAnswer>(response)).data.fresh).toBe(true)
  await close()
})

test('a body that does not match the schema is 400', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const response = await post(app, '/nonce/use', { address: 'not an address', nonce: '1', expiry: '1' })

  expect(response.status).toBe(400)
  await close()
})

test('a released nonce can be used again', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const request = { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) }

  await post(app, '/nonce/use', request)
  const released = await post(app, '/nonce/release', { address: ADDRESS, nonce: '1' })
  expect(released.status).toBe(200)
  expect((await body<{ success: true; data: { released: boolean } }>(released)).data.released).toBe(true)

  const again = await post(app, '/nonce/use', request)
  expect((await body<NonceAnswer>(again)).data.fresh).toBe(true)
  await close()
})

test('a spent nonce is never given back, so a replay of a finished request is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const request = { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) }

  await post(app, '/nonce/use', request)
  const committed = await post(app, '/nonce/commit', { address: ADDRESS, nonce: '1' })
  expect((await body<{ success: true; data: { committed: boolean } }>(committed)).data.committed).toBe(true)

  const released = await post(app, '/nonce/release', { address: ADDRESS, nonce: '1' })
  expect((await body<{ success: true; data: { released: boolean } }>(released)).data.released).toBe(false)

  const replay = await post(app, '/nonce/use', request)
  expect((await body<NonceAnswer>(replay)).data.fresh).toBe(false)
  await close()
})

test('committing a nonce that was never reserved changes nothing', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const committed = await post(app, '/nonce/commit', { address: ADDRESS, nonce: '9' })

  expect((await body<{ success: true; data: { committed: boolean } }>(committed)).data.committed).toBe(false)
  await close()
})

test('releasing a nonce that was never used changes nothing', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  const released = await post(app, '/nonce/release', { address: ADDRESS, nonce: '9' })

  expect((await body<{ success: true; data: { released: boolean } }>(released)).data.released).toBe(false)
  await close()
})

test('expired nonces and old rate rows are deleted by cleanup', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  await post(app, '/nonce/use', { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) })
  await post(app, '/rate/take', { key: 'd'.repeat(64), limit: 5, windowSeconds: 600 })

  const later = new Date(NOW.getTime() + 3600_000)
  const removed = await cleanup(db, later)

  expect(removed.nonces).toBe(1)
  expect(removed.rate).toBe(1)
  const nonces = await db.query('SELECT * FROM nonces')
  const rate = await db.query('SELECT * FROM rate')
  expect(nonces).toHaveLength(0)
  expect(rate).toHaveLength(0)
  await close()
})

test('cleanup keeps a nonce that has not expired and a rate row in its window', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })

  await post(app, '/nonce/use', { address: ADDRESS, nonce: '1', expiry: String(NOW_SECONDS + 300) })
  await post(app, '/rate/take', { key: 'd'.repeat(64), limit: 5, windowSeconds: 600 })

  const removed = await cleanup(db, NOW)

  expect(removed.nonces).toBe(0)
  expect(removed.rate).toBe(0)
  const nonces = await db.query('SELECT * FROM nonces')
  const rate = await db.query('SELECT * FROM rate')
  expect(nonces).toHaveLength(1)
  expect(rate).toHaveLength(1)
  await close()
})
