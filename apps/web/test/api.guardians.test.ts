import { describe, expect, test, vi } from 'vitest'

const { internalGet } = vi.hoisted(() => ({ internalGet: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet }
})

const { GET: listRoute } = await import('../app/api/guardians/route')
const { GET: detailRoute } = await import('../app/api/guardians/[address]/route')
const { InternalServiceError } = await import('../server/internal')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const OTHER = '0x1111111111111111111111111111111111111111'
const TARGET = `0x${'11'.repeat(32)}`

function summary(overrides: Record<string, unknown> = {}) {
  return {
    address: ADDRESS,
    score: 12,
    weight: 2,
    attestations: 3,
    penaltyPending: false,
    ...overrides,
  }
}

function listAnswer(items: unknown[], total = items.length, finalizedBlock = '12345') {
  return { data: { items }, meta: { finalizedBlock, page: { total, page: 1, limit: 20 } } }
}

function request(url: string): Request {
  return new Request(`http://localhost${url}`)
}

describe('the guardian list', () => {
  test('the guardians come from the internal service with the page of the meta', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([summary()], 1))
    const response = await listRoute(request('/api/guardians'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.items).toEqual([summary()])
    expect(body.meta).toEqual({ finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } })
    expect(internalGet).toHaveBeenCalledWith('/guardians', { page: 1, limit: 20 })
  })

  test('a page and a limit of the query are passed on', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([]))
    await listRoute(request('/api/guardians?page=2&limit=5'))
    expect(internalGet).toHaveBeenCalledWith('/guardians', { page: 2, limit: 5 })
  })

  test('a limit that is not a number is refused', async () => {
    internalGet.mockReset()
    const response = await listRoute(request('/api/guardians?limit=many'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a failure of the internal service is an error and never an empty list', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'The service is down.'))
    const response = await listRoute(request('/api/guardians'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('INTERNAL')
  })

  test('an answer without a finalized block is refused', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({ data: { items: [] }, meta: { page: { total: 0, page: 1, limit: 20 } } })
    const response = await listRoute(request('/api/guardians'))
    expect(response.status).toBe(503)
  })
})

describe('one guardian', () => {
  test('the guardian comes from the internal service', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({
      data: { ...summary(), createdAtBlock: '42', history: [] },
      meta: { finalizedBlock: '12345' },
    })
    const response = await detailRoute(request(`/api/guardians/${ADDRESS}`), {
      params: Promise.resolve({ address: ADDRESS }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({ address: ADDRESS, createdAtBlock: '42' })
    expect(internalGet).toHaveBeenCalledWith(`/guardians/${ADDRESS}`)
  })

  test('an address that is not an address is refused', async () => {
    internalGet.mockReset()
    const response = await detailRoute(request('/api/guardians/not-an-address'), {
      params: Promise.resolve({ address: 'not-an-address' }),
    })
    expect(response.status).toBe(400)
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a guardian the chain does not know is not found', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'There is no such guardian.'))
    const response = await detailRoute(request(`/api/guardians/${OTHER}`), {
      params: Promise.resolve({ address: OTHER }),
    })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

/** The target id of the guardian is never part of the answer, but the route keeps the schema honest. */
test('the guardian detail holds the history of the guardian', async () => {
    internalGet.mockReset()
  internalGet.mockResolvedValue({
    data: {
      ...summary(),
      createdAtBlock: '42',
      history: [{ kind: 'attestation', targetId: TARGET, label: 'A target', result: 'SAFE', xp: 2, at: '2026-11-25T10:00:00.000Z' }],
    },
    meta: { finalizedBlock: '12345' },
  })
  const response = await detailRoute(request(`/api/guardians/${ADDRESS}`), {
    params: Promise.resolve({ address: ADDRESS }),
  })
  const body = await response.json()
  expect(body.data.history).toHaveLength(1)
  expect(body.data.history[0].targetId).toBe(TARGET)
})
