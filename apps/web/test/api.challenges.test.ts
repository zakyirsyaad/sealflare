import { describe, expect, test, vi } from 'vitest'

const { internalGet } = vi.hoisted(() => ({ internalGet: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet }
})

const { GET: listRoute } = await import('../app/api/challenges/route')
const { GET: detailRoute } = await import('../app/api/challenges/[id]/route')
const { InternalServiceError } = await import('../server/internal')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const OTHER = '0x1111111111111111111111111111111111111111'
const TARGET = `0x${'11'.repeat(32)}`

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    targetId: TARGET,
    label: 'A target',
    challenger: ADDRESS,
    phase: 'COMMIT',
    outcome: 'PENDING',
    commitEndsAt: '2026-11-26T20:00:00.000Z',
    revealEndsAt: '2026-11-27T08:00:00.000Z',
    commits: 3,
    reveals: 0,
    ...overrides,
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...summary(),
    flags: 0,
    shortProof: 'UNEXPECTED_DELEGATECALL @ Contract.sol:12: delegatecall',
    evidenceURI: 'ipfs://evidence',
    counterEvidenceURI: null,
    publisher: null,
    jurors: [{ address: OTHER, weight: 2, revealed: false, uphold: null }],
    upholdWeight: 0,
    rejectWeight: 0,
    payouts: [],
    ...overrides,
  }
}

function listAnswer(items: unknown[], total = items.length, finalizedBlock = '12345') {
  return { data: { items }, meta: { finalizedBlock, page: { total, page: 1, limit: 20 } } }
}

function request(url: string): Request {
  return new Request(`http://localhost${url}`)
}

describe('the dispute list', () => {
  test('the disputes come from the internal service with the page of the meta', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([summary()], 1))
    const response = await listRoute(request('/api/challenges'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(1)
    expect(body.meta).toEqual({ finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } })
    expect(internalGet).toHaveBeenCalledWith('/challenges', { page: 1, limit: 20 })
  })

  test('a target of the query narrows the list', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([]))
    await listRoute(request(`/api/challenges?targetId=${TARGET}`))
    expect(internalGet).toHaveBeenCalledWith('/challenges', { page: 1, limit: 20, targetId: TARGET })
  })

  test('a target that is not a 32 byte hex value is refused', async () => {
    internalGet.mockReset()
    const response = await listRoute(request('/api/challenges?targetId=nope'))
    expect(response.status).toBe(400)
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a failure of the internal service is an error and never an empty list', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'The service is down.'))
    const response = await listRoute(request('/api/challenges'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.success).toBe(false)
  })
})

describe('one dispute', () => {
  test('the dispute comes from the internal service', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({ data: detail(), meta: { finalizedBlock: '12345' } })
    const response = await detailRoute(request('/api/challenges/1'), { params: Promise.resolve({ id: '1' }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.id).toBe('1')
    expect(internalGet).toHaveBeenCalledWith('/challenges/1')
  })

  test('no direction of a vote is in the answer during the commit phase', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({
      data: detail({
        phase: 'COMMIT',
        jurors: [{ address: OTHER, weight: 2, revealed: true, uphold: true }],
      }),
      meta: { finalizedBlock: '12345' },
    })
    const response = await detailRoute(request('/api/challenges/1'), { params: Promise.resolve({ id: '1' }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.jurors[0].uphold).toBeNull()
  })

  test('the direction of a revealed vote is in the answer after the commit phase', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({
      data: detail({
        phase: 'AWAITING_CLOSE',
        jurors: [{ address: OTHER, weight: 2, revealed: true, uphold: true }],
      }),
      meta: { finalizedBlock: '12345' },
    })
    const response = await detailRoute(request('/api/challenges/1'), { params: Promise.resolve({ id: '1' }) })
    const body = await response.json()
    expect(body.data.jurors[0].uphold).toBe(true)
  })

  test('an id that is not a whole number is refused', async () => {
    internalGet.mockReset()
    const response = await detailRoute(request('/api/challenges/abc'), {
      params: Promise.resolve({ id: 'abc' }),
    })
    expect(response.status).toBe(400)
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a dispute the chain does not have is not found', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'There is no such dispute.'))
    const response = await detailRoute(request('/api/challenges/99'), { params: Promise.resolve({ id: '99' }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
