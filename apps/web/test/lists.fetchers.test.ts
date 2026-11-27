import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../lib/api/client'
import { loadGuardian, loadGuardians, loadTargets } from '../lib/api/lists'

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const TARGET_ID = `0x${'11'.repeat(32)}`

const fetchMock = vi.fn()

function summary() {
  return {
    targetId: TARGET_ID,
    targetType: 'SMART_CONTRACT',
    label: ADDRESS,
    src: ADDRESS,
    tier: 'CAUTION_FLAGGED',
    safe: 1,
    caution: 0,
    danger: 0,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-25T03:00:00.000Z',
  }
}

function guardian() {
  return { address: ADDRESS, score: 12, weight: 2, attestations: 3, penaltyPending: false }
}

/** An answer of the API, as the server sends it. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The URL of the first request the fetcher made. */
function firstUrl(): string {
  const call = fetchMock.mock.calls[0]
  expect(call).toBeDefined()
  return String(call?.[0])
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the fetchers of the list routes', () => {
  test('the target list is read from the envelope of the route', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        data: { items: [summary()] },
        meta: { finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } },
      }),
    )
    const answer = await loadTargets({ page: 1, limit: 20 })
    expect(answer.items).toHaveLength(1)
    expect(answer.total).toBe(1)
    expect(answer.finalizedBlock).toBe('12345')
    expect(firstUrl()).toContain('/api/targets?page=1&limit=20')
  })

  test('the filter of the list is part of the request', async () => {
    fetchMock.mockResolvedValue(
      json({ success: true, data: { items: [] }, meta: { finalizedBlock: '1', page: { total: 0, page: 1, limit: 20 } } }),
    )
    await loadTargets({ page: 2, limit: 20, type: 'AI_SKILL_BUNDLE', verdict: 'SAFE' })
    const url = firstUrl()
    expect(url).toContain('page=2')
    expect(url).toContain('type=AI_SKILL_BUNDLE')
    expect(url).toContain('verdict=SAFE')
  })

  test('an error envelope of the route is an error, not an empty list', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ success: false, error: { code: 'BAD_REQUEST', message: 'Narrow the filter.' } })),
    )
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toThrow(ApiError)
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  test('an answer that is not the shape of the route is refused', async () => {
    // The row is not a target, so the answer cannot be shown as a list of targets.
    fetchMock.mockResolvedValue(
      json({ success: true, data: { items: [{ targetId: 'not a hash' }] }, meta: { finalizedBlock: '1', page: { total: 1, page: 1, limit: 20 } } }),
    )
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('an answer that carries more than the route allows is refused', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        data: { items: [] },
        meta: { finalizedBlock: '1', page: { total: 0, page: 1, limit: 20 } },
        extra: 'not part of the route',
      }),
    )
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('an answer without the block it was read at is refused', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: { items: [] }, meta: { page: { total: 0, page: 1, limit: 20 } } }))
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('a registry that cannot be reached is an error', async () => {
    fetchMock.mockRejectedValue(new Error('the network is down'))
    await expect(loadTargets({ page: 1, limit: 20 })).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('the guardian list is read with its total and its block', async () => {
    fetchMock.mockResolvedValue(
      json({ success: true, data: { items: [guardian()] }, meta: { finalizedBlock: '77', page: { total: 1, page: 1, limit: 20 } } }),
    )
    const answer = await loadGuardians({ page: 1, limit: 20 })
    expect(answer.items).toHaveLength(1)
    expect(answer.total).toBe(1)
    expect(answer.finalizedBlock).toBe('77')
    expect(firstUrl()).toContain('/api/guardians?page=1&limit=20')
  })

  test('one guardian is read by its address', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        data: { ...guardian(), createdAtBlock: '42', history: [] },
        meta: { finalizedBlock: '77' },
      }),
    )
    const answer = await loadGuardian(ADDRESS)
    expect(answer.item.address).toBe(ADDRESS)
    expect(answer.finalizedBlock).toBe('77')
    expect(firstUrl()).toContain(`/api/guardians/${ADDRESS}`)
  })

  test('an address that is not an address never reaches the API', async () => {
    await expect(loadGuardian('not-an-address')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
