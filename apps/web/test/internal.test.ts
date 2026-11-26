import { afterEach, describe, expect, test, vi } from 'vitest'

const { internalGet, internalPost, InternalServiceError } = await import('../server/internal')

function answer(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

describe('the client of the internal service', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('a read carries the inter-service key and the query', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    const fetchMock = vi.fn().mockResolvedValue(answer({ success: true, data: { items: [] }, meta: { finalizedBlock: '42' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await internalGet<{ items: unknown[] }>('/targets', { page: 2, limit: 10, address: undefined })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://internal.example.com/targets?page=2&limit=10')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only-key')
    expect(init.signal).toBeDefined()
    expect(result.meta.finalizedBlock).toBe('42')
    expect(result.data.items).toEqual([])
  })

  test('a write sends the body as JSON', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com/')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    const fetchMock = vi.fn().mockResolvedValue(answer({ success: true, data: { fresh: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await internalPost<{ fresh: boolean }>('/nonce/use', { address: '0x1', nonce: '2' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://internal.example.com/nonce/use')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ address: '0x1', nonce: '2' }))
    expect(result.data.fresh).toBe(true)
  })

  test('a refused answer is an error and never an empty list', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => answer({ success: false, error: { code: 'NOT_FOUND', message: 'no such target' } })))
    await expect(internalGet('/targets/1')).rejects.toBeInstanceOf(InternalServiceError)
    await expect(internalGet('/targets/1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  test('a service that cannot be reached is an error', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('the socket closed')))
    await expect(internalGet('/targets')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('an answer that is not an envelope is an error', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ items: [] })))
    await expect(internalGet('/targets')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('a read without a meta block is an error, because the block it was read at is unknown', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ success: true, data: { items: [] } })))
    await expect(internalGet('/targets')).rejects.toBeInstanceOf(InternalServiceError)
    await expect(internalGet('/targets')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('a meta block of the wrong shape is an error, and never a page of its own', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ success: true, data: { items: [] }, meta: { page: { total: 'many' } } })))
    await expect(internalGet('/targets')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  test('a write of the nonce has no block to name, so it needs no meta block', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ success: true, data: { fresh: true } })))
    const result = await internalPost<{ fresh: boolean }>('/nonce/use', { address: '0x1', nonce: '2' })
    expect(result.data.fresh).toBe(true)
    expect(result.meta).toEqual({})
  })

  test('a missing internal url is a configuration error and never a request', async () => {
    vi.stubEnv('INTERNAL_URL', '')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(internalGet('/targets')).rejects.toThrow('INTERNAL_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
