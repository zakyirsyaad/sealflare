import { afterEach, describe, expect, test, vi } from 'vitest'

const internalPost = vi.hoisted(() => vi.fn())
vi.mock('../server/internal', () => ({ internalPost }))

const { takeRateLimit } = await import('../server/rate')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

describe('the rate limits of the public API', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    internalPost.mockReset()
  })

  test('a scan is limited to twenty in ten minutes', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    internalPost.mockResolvedValue({ data: { allowed: true, retryAfterSeconds: 0 }, meta: {} })
    await takeRateLimit('scan', '203.0.113.7')
    const [path, body] = internalPost.mock.calls[0] as [string, { key: string; limit: number; windowSeconds: number }]
    expect(path).toBe('/rate/take')
    expect(body.limit).toBe(20)
    expect(body.windowSeconds).toBe(600)
  })

  test('an evidence upload is limited to thirty in an hour', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    internalPost.mockResolvedValue({ data: { allowed: true, retryAfterSeconds: 0 }, meta: {} })
    await takeRateLimit('evidence', ADDRESS)
    const [, body] = internalPost.mock.calls[0] as [string, { key: string; limit: number; windowSeconds: number }]
    expect(body.limit).toBe(30)
    expect(body.windowSeconds).toBe(3600)
  })

  test('the key of a caller is a hash and never the address', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    internalPost.mockResolvedValue({ data: { allowed: true, retryAfterSeconds: 0 }, meta: {} })
    await takeRateLimit('evidence', ADDRESS)
    const [, body] = internalPost.mock.calls[0] as [string, { key: string }]
    expect(body.key).toMatch(/^[0-9a-f]{64}$/)
    expect(body.key).not.toContain(ADDRESS.slice(2))
  })

  test('two callers do not share a key', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    internalPost.mockResolvedValue({ data: { allowed: true, retryAfterSeconds: 0 }, meta: {} })
    await takeRateLimit('evidence', ADDRESS)
    await takeRateLimit('evidence', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    const keys = internalPost.mock.calls.map(call => (call[1] as { key: string }).key)
    expect(keys[0]).not.toBe(keys[1])
  })

  test('the answer of the internal service is the answer of the limit', async () => {
    vi.stubEnv('INTERNAL_URL', 'https://internal.example.com')
    vi.stubEnv('INTERNAL_KEY', 'test-only-key')
    internalPost.mockResolvedValue({ data: { allowed: false, retryAfterSeconds: 120 }, meta: {} })
    expect(await takeRateLimit('scan', '203.0.113.7')).toEqual({ allowed: false, retryAfterSeconds: 120 })
  })
})
