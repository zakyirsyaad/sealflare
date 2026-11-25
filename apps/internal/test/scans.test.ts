import { expect, test } from 'vitest'
import { ScanReport } from '@sealflare/shared/schemas'
import contractClean from '@sealflare/shared/fixtures/scans/contract-clean.json'
import { body, createTestDb, get, headers, put, testApp } from './helpers'

const REPORT = contractClean as unknown as Record<string, unknown>
const TARGET_ID = REPORT.targetId as string
const ADDRESS = (REPORT.source as { address: string }).address

type ScanAnswer = { success: true; data: Record<string, unknown> }
type ErrorAnswer = { success: false; error: { code: string; message: string } }

test('a stored scan is returned unchanged and passes ScanReport', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const stored = await put(app, `/scans/${TARGET_ID}`, REPORT)
  expect(stored.status).toBe(200)

  const response = await get(app, `/scans/${TARGET_ID}`)
  expect(response.status).toBe(200)
  const answer = await body<ScanAnswer>(response)
  expect(answer.data).toEqual(REPORT)
  expect(ScanReport.safeParse(answer.data).success).toBe(true)
  await close()
})

test('the source of the report is stored next to it', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, REPORT)

  const rows = await db.query<{ src: string }>('SELECT src FROM scan_cache WHERE target_id = $1', [TARGET_ID])
  expect(rows[0]?.src).toBe(ADDRESS)
  await close()
})

test('storing a body that fails ScanReport is 400 and stores nothing', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await put(app, `/scans/${TARGET_ID}`, { ...REPORT, flags: 99 })

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM scan_cache')
  expect(rows).toHaveLength(0)
  await close()
})

test('a body that is not JSON is 400 and stores nothing', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await app.request(`/scans/${TARGET_ID}`, {
    method: 'PUT',
    headers: headers(),
    body: 'not json',
  })

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM scan_cache')
  expect(rows).toHaveLength(0)
  await close()
})

test('a report of another target is 400 and stores nothing', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)
  const other = `0x${'ab'.repeat(32)}`

  const response = await put(app, `/scans/${other}`, REPORT)

  expect(response.status).toBe(400)
  const rows = await db.query('SELECT * FROM scan_cache')
  expect(rows).toHaveLength(0)
  await close()
})

test('GET of an unknown target id is 404 with code RESULT_NOT_CACHED', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await get(app, `/scans/0x${'cd'.repeat(32)}`)

  expect(response.status).toBe(404)
  const answer = await body<ErrorAnswer>(response)
  expect(answer.success).toBe(false)
  expect(answer.error.code).toBe('RESULT_NOT_CACHED')
  await close()
})

test('a second scan of the same target replaces the first one', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, REPORT)
  const later = { ...REPORT, scannedAt: '2026-11-25T12:00:00.000Z' }
  await put(app, `/scans/${TARGET_ID}`, later)

  const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM scan_cache')
  expect(rows[0]?.count).toBe(1)
  const response = await get(app, `/scans/${TARGET_ID}`)
  expect((await body<ScanAnswer>(response)).data.scannedAt).toBe('2026-11-25T12:00:00.000Z')
  await close()
})

test('a target id that is not 32 bytes is 400', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await get(app, '/scans/0xabc')

  expect(response.status).toBe(400)
  await close()
})

test('an older scan does not replace a newer one', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  await put(app, `/scans/${TARGET_ID}`, { ...REPORT, scannedAt: '2026-11-25T12:00:00.000Z' })
  await put(app, `/scans/${TARGET_ID}`, { ...REPORT, scannedAt: '2026-11-25T10:00:00.000Z' })

  const response = await get(app, `/scans/${TARGET_ID}`)
  expect((await body<ScanAnswer>(response)).data.scannedAt).toBe('2026-11-25T12:00:00.000Z')
  const rows = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM scan_cache')
  expect(rows[0]?.count).toBe(1)
  await close()
})
