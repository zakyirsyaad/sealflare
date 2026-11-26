import { describe, expect, beforeEach, test, vi } from 'vitest'
import { AttestationsListResponse, TargetDetailResponse, TargetsListResponse } from '@sealflare/shared/schemas'

const { internalGet, internalPost } = vi.hoisted(() => ({ internalGet: vi.fn(), internalPost: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet, internalPost }
})

const reader = vi.hoisted(() => ({
  tierAt: vi.fn(),
  tierBlockNumber: vi.fn(),
  isAgentIdHolder: vi.fn(),
  tier: vi.fn(),
  target: vi.fn(),
  attestations: vi.fn(),
  evidence: vi.fn(),
  bond: vi.fn(),
}))
vi.mock('../server/chain', () => ({ getChainReader: () => reader }))

const { GET: listRoute } = await import('../app/api/targets/route')
const { GET: detailRoute } = await import('../app/api/targets/[id]/route')
const { GET: attestationsRoute } = await import('../app/api/targets/[id]/attestations/route')
const { InternalServiceError } = await import('../server/internal')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const FIRST = `0x${'11'.repeat(32)}`
const SECOND = `0x${'22'.repeat(32)}`
const THIRD = `0x${'33'.repeat(32)}`

function group() {
  return { votes: { safe: 0, caution: 0, danger: 0 }, weight: { safe: 0, caution: 0, danger: 0 }, flags: 0 }
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    targetId: FIRST,
    targetType: 'SMART_CONTRACT',
    label: ADDRESS,
    src: ADDRESS,
    tier: null,
    safe: 1,
    caution: 0,
    danger: 0,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-25T03:00:00.000Z',
    ...overrides,
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...summary(),
    publisher: null,
    pinnedCodehash: `0x${'44'.repeat(32)}`,
    hasDelegatecall: false,
    activeFlags: 0,
    signal: { newIds: group(), guardians: group() },
    activeChallengeId: null,
    attestationCount: 0,
    scan: null,
    sandbox: null,
    ...overrides,
  }
}

function listAnswer(items: unknown[], total = items.length, finalizedBlock = '12345') {
  return { data: { items }, meta: { finalizedBlock, page: { total, page: 1, limit: 20 } } }
}

function request(url: string): Request {
  return new Request(`http://localhost${url}`)
}

function detailRequest(id: string, url = `/api/targets/${id}`): Request {
  return new Request(`http://localhost${url}`)
}

async function answer(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

describe('the public target API', () => {
  beforeEach(() => {
    internalGet.mockReset()
    internalPost.mockReset()
    reader.tierAt.mockReset()
    reader.tierBlockNumber.mockReset()
    reader.tierBlockNumber.mockResolvedValue(99n)
    reader.tierAt.mockResolvedValue('COMMUNITY_SAFE')
  })

  test('the list fills the tier from Core.tierOf, not from the indexer', async () => {
    internalGet.mockResolvedValue(listAnswer([summary()]))
    const response = await listRoute(request('/api/targets'))
    expect(response.status).toBe(200)
    const body = await answer(response)
    expect(TargetsListResponse.safeParse(body).success).toBe(true)
    expect(body.data.items[0].tier).toBe('COMMUNITY_SAFE')
    expect(body.data.items[0].safe).toBe(1)
    expect(reader.tierAt).toHaveBeenCalledWith(FIRST, 99n)
  })

  test('the answer carries meta.finalizedBlock from the internal snapshot', async () => {
    internalGet.mockResolvedValue(listAnswer([summary()], 1, '987654'))
    const response = await listRoute(request('/api/targets'))
    const body = await answer(response)
    expect(body.meta.finalizedBlock).toBe('987654')
  })

  test('a query that is not valid is BAD_REQUEST', async () => {
    for (const url of ['/api/targets?page=0', '/api/targets?limit=101', '/api/targets?tier=NOPE', '/api/targets?address=nope']) {
      const response = await listRoute(request(url))
      expect(response.status).toBe(400)
      expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    }
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a tier filter keeps the internal order and reads every tier at one block', async () => {
    internalGet.mockResolvedValue({ data: { items: [summary({ targetId: FIRST }), summary({ targetId: SECOND })] }, meta: { finalizedBlock: '12345' } })
    reader.tierAt.mockImplementation(async (id: string) => (id === FIRST ? 'COMMUNITY_SAFE' : 'CONFIRMED_DANGER'))
    const response = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE'))
    const body = await answer(response)
    expect(body.data.items.map((item: { targetId: string }) => item.targetId)).toEqual([FIRST])
    expect(body.meta.page.total).toBe(1)
    expect(reader.tierAt).toHaveBeenCalledTimes(2)
    const blocks = new Set(reader.tierAt.mock.calls.map(call => String(call[1])))
    expect(blocks.size).toBe(1)
  })

  test('a verdict filter holds every tier of that verdict', async () => {
    internalGet.mockResolvedValue({
      data: { items: [summary({ targetId: FIRST }), summary({ targetId: SECOND }), summary({ targetId: THIRD })] },
      meta: { finalizedBlock: '12345' },
    })
    reader.tierAt.mockImplementation(async (id: string) => {
      if (id === FIRST) return 'COMMUNITY_SAFE'
      if (id === SECOND) return 'WARRANTY_BACKED_SAFE'
      return 'CAUTION_FLAGGED'
    })
    const response = await listRoute(request('/api/targets?verdict=SAFE'))
    const body = await answer(response)
    expect(body.data.items.map((item: { targetId: string }) => item.targetId)).toEqual([FIRST, SECOND])
    expect(body.meta.page.total).toBe(2)
  })

  test('a verdict that is not a verdict is BAD_REQUEST', async () => {
    const response = await listRoute(request('/api/targets?verdict=MAYBE'))
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a query that names a tier and a verdict is refused', async () => {
    const response = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE&verdict=SAFE'))
    expect(response.status).toBe(400)
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a tier filter reads the candidates of the internal service, not one page of the list', async () => {
    internalGet.mockResolvedValue({ data: { items: [summary()] }, meta: { finalizedBlock: '12345' } })
    await listRoute(request('/api/targets?tier=COMMUNITY_SAFE'))
    expect(internalGet).toHaveBeenCalledWith('/targets/tier-candidates', expect.anything())
  })

  test('a matching target beyond the first candidate page appears in the first filtered page', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `0x${String(index + 1).padStart(4, '0')}${'44'.repeat(30)}`)
    internalGet.mockResolvedValue({ data: { items: ids.map(targetId => summary({ targetId })) }, meta: { finalizedBlock: '12345' } })
    reader.tierAt.mockImplementation(async (id: string) => (id === ids[20] ? 'COMMUNITY_SAFE' : 'UNRATED'))
    const response = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE&limit=20'))
    const body = await answer(response)
    expect(body.data.items.map((item: { targetId: string }) => item.targetId)).toEqual([ids[20]])
    expect(body.meta.page).toEqual({ total: 1, page: 1, limit: 20 })
  })

  test('a list without a total is a 503 and never a wrong number', async () => {
    internalGet.mockResolvedValue({ data: { items: [summary()] }, meta: { finalizedBlock: '12345' } })
    const response = await listRoute(request('/api/targets'))
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.data).toBeUndefined()
  })

  test('a filtered page past the end still names the real total', async () => {
    internalGet.mockResolvedValue({ data: { items: [summary({ targetId: FIRST }), summary({ targetId: SECOND })] }, meta: { finalizedBlock: '12345' } })
    reader.tierAt.mockResolvedValue('COMMUNITY_SAFE')
    const second = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE&page=2&limit=1'))
    const secondBody = await answer(second)
    expect(secondBody.data.items.map((item: { targetId: string }) => item.targetId)).toEqual([SECOND])
    expect(secondBody.meta.page).toEqual({ total: 2, page: 2, limit: 1 })
    const past = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE&page=9&limit=1'))
    const pastBody = await answer(past)
    expect(pastBody.data.items).toEqual([])
    expect(pastBody.meta.page).toEqual({ total: 2, page: 9, limit: 1 })
  })

  test('too many candidates ask for a narrower filter instead of a 503', async () => {
    internalGet.mockRejectedValue(
      new InternalServiceError('BAD_REQUEST', 'There are more than 500 candidates, so the filters have to be narrower.'),
    )
    const response = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE'))
    expect(response.status).toBe(400)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.data).toBeUndefined()
  })

  test('a failure of the internal service is a 503 without partial data', async () => {
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'the service is down'))
    const response = await listRoute(request('/api/targets'))
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('INTERNAL')
    expect(body.data).toBeUndefined()
  })

  test('a filter of few candidates that runs out of time is a failure of the read', async () => {
    vi.useFakeTimers()
    try {
      internalGet.mockResolvedValue({ data: { items: [summary()] }, meta: { finalizedBlock: '12345' } })
      // The tier never arrives, so the request runs out of time.
      reader.tierAt.mockImplementation(() => new Promise(() => {}))
      const pending = listRoute(request('/api/targets?verdict=SAFE'))
      await vi.advanceTimersByTimeAsync(9000)
      const response = await pending
      // The filter covers one target, so it was not too wide. The read ran out of time, and the
      // answer says so instead of asking for a narrower filter that was fine.
      expect(response.status).toBe(503)
      const body = await answer(response)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('INTERNAL')
      expect(body.error.message).not.toContain('Narrow the filter')
      expect(body.data).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a filter that covers many candidates and runs out of time asks for a narrower filter', async () => {
    vi.useFakeTimers()
    try {
      const candidates = Array.from({ length: 101 }, (_, index) =>
        summary({ targetId: `0x${String(index + 1).padStart(64, '0')}` }),
      )
      internalGet.mockResolvedValue({ data: { items: candidates }, meta: { finalizedBlock: '12345' } })
      reader.tierAt.mockImplementation(() => new Promise(() => {}))
      const pending = listRoute(request('/api/targets?verdict=SAFE'))
      await vi.advanceTimersByTimeAsync(9000)
      const response = await pending
      // More candidates than one round of tier reads cannot be answered inside the deadline, so
      // the reader is asked for a narrower filter.
      expect(response.status).toBe(400)
      const body = await answer(response)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.error.message).toContain('Narrow the filter')
      expect(body.data).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a failed tier read is a 503 without partial data', async () => {
    internalGet.mockResolvedValue({ data: { items: [summary()] }, meta: { finalizedBlock: '12345' } })
    reader.tierAt.mockRejectedValue(new Error('rpc down'))
    const response = await listRoute(request('/api/targets'))
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.data).toBeUndefined()
  })

  test('the internal read and the tier reads share the one deadline of the route', async () => {
    vi.useFakeTimers()
    try {
      const candidates = Array.from({ length: 250 }, (_, index) =>
        summary({ targetId: `0x${String(index + 1).padStart(64, '0')}` }),
      )
      // The internal read takes 5 s and every batch of tiers takes 2 s, so the route has 3 s left
      // when it reaches the tiers. A deadline that starts again there would run until 13 s.
      internalGet.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ data: { items: candidates }, meta: { finalizedBlock: '12345' } }), 5_000)),
      )
      reader.tierAt.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('COMMUNITY_SAFE'), 2_000)))

      const pending = listRoute(request('/api/targets?tier=COMMUNITY_SAFE'))
      await vi.advanceTimersByTimeAsync(8_000)
      const response = await pending
      await vi.advanceTimersByTimeAsync(20_000)

      // A filter that runs out of time covers more targets than one request can read, so the
      // reader is asked for a narrower filter.
      expect(response.status).toBe(400)
      expect((await answer(response)).error.code).toBe('BAD_REQUEST')
      // The batches that started before the deadline were two. The third never started.
      expect(reader.tierAt).toHaveBeenCalledTimes(200)
    } finally {
      vi.useRealTimers()
    }
  })

  test('the internal service being down is an error envelope, never an empty list', async () => {
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'the service is down'))
    const response = await listRoute(request('/api/targets'))
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.data).toBeUndefined()
  })

  test('the detail fills the tier from Core.tierOf and passes the public schema', async () => {
    internalGet.mockResolvedValue({ data: detail(), meta: { finalizedBlock: '12345' } })
    const response = await detailRoute(detailRequest(FIRST), { params: Promise.resolve({ id: FIRST }) })
    expect(response.status).toBe(200)
    const body = await answer(response)
    expect(TargetDetailResponse.safeParse(body).success).toBe(true)
    expect(body.data.tier).toBe('COMMUNITY_SAFE')
    expect(body.meta.finalizedBlock).toBe('12345')
  })

  test('an unknown target is a 404, not an empty object', async () => {
    internalGet.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'there is no such target'))
    const response = await detailRoute(detailRequest(FIRST), { params: Promise.resolve({ id: FIRST }) })
    expect(response.status).toBe(404)
    const body = await answer(response)
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.data).toBeUndefined()
  })

  test('a target id that is not a 32 byte hex value is BAD_REQUEST', async () => {
    const response = await detailRoute(detailRequest('nope'), { params: Promise.resolve({ id: 'nope' }) })
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a failed tier read of the detail is an error envelope', async () => {
    internalGet.mockResolvedValue({ data: detail(), meta: { finalizedBlock: '12345' } })
    reader.tierAt.mockRejectedValue(new Error('rpc down'))
    const response = await detailRoute(detailRequest(FIRST), { params: Promise.resolve({ id: FIRST }) })
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.data).toBeUndefined()
  })

  test('the attestation list answers the frozen rows and the page', async () => {
    internalGet.mockResolvedValue({
      data: { items: [{ index: 0, guardian: ADDRESS, verdict: 'SAFE', flags: 0, weight: 1, safeOrdinal: 1, shortProof: 'ok', evidenceURI: '', txHash: `0x${'55'.repeat(32)}`, at: '2026-11-25T03:00:00.000Z', settled: true, castDuringDispute: false }] },
      meta: { finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } },
    })
    const response = await attestationsRoute(detailRequest(FIRST, `/api/targets/${FIRST}/attestations`), { params: Promise.resolve({ id: FIRST }) })
    expect(response.status).toBe(200)
    const body = await answer(response)
    expect(AttestationsListResponse.safeParse(body).success).toBe(true)
    expect(body.data.items[0].verdict).toBe('SAFE')
    expect(body.meta.page.total).toBe(1)
  })

  test('the attestation list of an unknown target is a 404', async () => {
    internalGet.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'there is no such target'))
    const response = await attestationsRoute(detailRequest(FIRST, `/api/targets/${FIRST}/attestations`), { params: Promise.resolve({ id: FIRST }) })
    expect(response.status).toBe(404)
    expect((await answer(response)).error.code).toBe('NOT_FOUND')
  })
})
