import { describe, expect, beforeEach, test, vi } from 'vitest'
import { AttestationsListResponse, TargetDetailResponse, TargetsListResponse } from '@sealflare/shared/schemas'

const { internalGet, internalPost } = vi.hoisted(() => ({ internalGet: vi.fn(), internalPost: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet, internalPost }
})

const reader = vi.hoisted(() => ({
  tierAt: vi.fn(),
  blockNumber: vi.fn(),
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
    reader.blockNumber.mockReset()
    reader.blockNumber.mockResolvedValue(99n)
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

  test('too many candidates are a 503 without partial data', async () => {
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'too many candidates'))
    const response = await listRoute(request('/api/targets?tier=COMMUNITY_SAFE'))
    expect(response.status).toBe(503)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('INTERNAL')
    expect(body.data).toBeUndefined()
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
