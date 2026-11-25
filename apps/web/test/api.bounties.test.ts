import { describe, expect, test, vi } from 'vitest'

const { internalGet } = vi.hoisted(() => ({ internalGet: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet }
})

const { GET: listRoute } = await import('../app/api/bounties/route')
const { GET: detailRoute } = await import('../app/api/bounties/[id]/route')
const { InternalServiceError } = await import('../server/internal')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const OTHER = '0x1111111111111111111111111111111111111111'
const TARGET = `0x${'11'.repeat(32)}`

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    targetId: TARGET,
    label: 'A target',
    requester: ADDRESS,
    slots: 3,
    filled: 1,
    amount: '1000',
    createdAt: '2026-11-25T10:00:00.000Z',
    settleableAt: '2026-11-26T08:00:00.000Z',
    settled: false,
    ...overrides,
  }
}

function listAnswer(items: unknown[], total = items.length, finalizedBlock = '12345') {
  return { data: { items }, meta: { finalizedBlock, page: { total, page: 1, limit: 20 } } }
}

function request(url: string): Request {
  return new Request(`http://localhost${url}`)
}

describe('the bounty list', () => {
  test('the bounties come from the internal service with the page of the meta', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([summary()], 1))
    const response = await listRoute(request('/api/bounties'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.items).toHaveLength(1)
    expect(body.meta).toEqual({ finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } })
    expect(internalGet).toHaveBeenCalledWith('/bounties', { page: 1, limit: 20 })
  })

  test('a target of the query narrows the list', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue(listAnswer([]))
    await listRoute(request(`/api/bounties?targetId=${TARGET}`))
    expect(internalGet).toHaveBeenCalledWith('/bounties', { page: 1, limit: 20, targetId: TARGET })
  })

  test('a failure of the internal service is an error and never an empty list', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'The service is down.'))
    const response = await listRoute(request('/api/bounties'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.success).toBe(false)
  })
})

describe('one bounty', () => {
  test('the bounty comes with the slots that filled it', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({
      data: { ...summary(), fillers: [{ guardian: OTHER, verdict: 'DANGER' }] },
      meta: { finalizedBlock: '12345' },
    })
    const response = await detailRoute(request('/api/bounties/1'), { params: Promise.resolve({ id: '1' }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.fillers).toEqual([{ guardian: OTHER, verdict: 'DANGER' }])
    expect(internalGet).toHaveBeenCalledWith('/bounties/1')
  })

  test('a bounty that does not exist is not found', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'There is no such bounty.'))
    const response = await detailRoute(request('/api/bounties/99'), { params: Promise.resolve({ id: '99' }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
