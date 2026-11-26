import { describe, expect, test, vi } from 'vitest'

const { internalGet } = vi.hoisted(() => ({ internalGet: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet }
})

const { GET: activityRoute } = await import('../app/api/activity/[address]/route')
const { InternalServiceError } = await import('../server/internal')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const TARGET = `0x${'11'.repeat(32)}`

function activity(overrides: Record<string, unknown> = {}) {
  return {
    needsAction: [
      {
        kind: 'REVEAL_DUE',
        targetId: TARGET,
        challengeId: '1',
        dueAt: '2026-11-26T23:00:00.000Z',
        detail: 'Reveal the vote of the dispute.',
      },
    ],
    balance: '600',
    score: 12,
    weight: 2,
    toNextWeight: 13,
    history: [
      {
        kind: 'attestation',
        targetId: TARGET,
        label: 'A target',
        result: 'SAFE',
        xp: 2,
        at: '2026-11-25T10:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

function request(url: string): Request {
  return new Request(`http://localhost${url}`)
}

describe('the activity of an account', () => {
  test('the activity comes from the internal service', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({ data: activity(), meta: { finalizedBlock: '12345' } })
    const response = await activityRoute(request(`/api/activity/${ADDRESS}`), {
      params: Promise.resolve({ address: ADDRESS }),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.balance).toBe('600')
    expect(body.data.needsAction[0].kind).toBe('REVEAL_DUE')
    expect(body.meta).toEqual({ finalizedBlock: '12345' })
    expect(internalGet).toHaveBeenCalledWith(`/activity/${ADDRESS}`)
  })

  test('an address that is not an address is refused', async () => {
    internalGet.mockReset()
    const response = await activityRoute(request('/api/activity/not-an-address'), {
      params: Promise.resolve({ address: 'not-an-address' }),
    })
    expect(response.status).toBe(400)
    expect(internalGet).not.toHaveBeenCalled()
  })

  test('a failure of the internal service is an error and never an empty activity', async () => {
    internalGet.mockReset()
    internalGet.mockRejectedValue(new InternalServiceError('INTERNAL', 'The service is down.'))
    const response = await activityRoute(request(`/api/activity/${ADDRESS}`), {
      params: Promise.resolve({ address: ADDRESS }),
    })
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.success).toBe(false)
  })

  test('an answer without a finalized block is refused', async () => {
    internalGet.mockReset()
    internalGet.mockResolvedValue({ data: activity(), meta: {} })
    const response = await activityRoute(request(`/api/activity/${ADDRESS}`), {
      params: Promise.resolve({ address: ADDRESS }),
    })
    expect(response.status).toBe(503)
  })
})
