import { expect, test, vi } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'

type ErrorAnswer = { success: false; error: { code: string; message: string } }

test('an unknown route answers in the same shape as every other answer', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db)

  const response = await get(app, '/nowhere')

  expect(response.status).toBe(404)
  const answer = await body<ErrorAnswer>(response)
  expect(answer.success).toBe(false)
  expect(answer.error.code).toBe('BAD_REQUEST')
  await close()
})

test('a route that throws answers in the same shape and shows no stack', async () => {
  const { db, close } = await createTestDb()
  const broken = {
    query: () => Promise.reject(new Error('the database is on fire')),
    exec: () => Promise.reject(new Error('the database is on fire')),
    transaction: <T>(_fn: (tx: unknown) => Promise<T>) => Promise.reject(new Error('the database is on fire')),
  }
  const { app } = testApp(broken as never)
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

  const response = await get(app, `/scans/0x${'ab'.repeat(32)}`)

  expect(response.status).toBe(500)
  const answer = await body<ErrorAnswer>(response)
  expect(answer.error.code).toBe('INTERNAL')
  expect(JSON.stringify(answer)).not.toContain('on fire')
  expect(logged).toHaveBeenCalled()
  logged.mockRestore()
  await close()
})
