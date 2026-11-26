import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readIndexedEvidence } from '../server/indexedEvidence'

const TARGET = `0x${'ab'.repeat(32)}`
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

function row(index: number, uri: string) {
  return {
    index,
    guardian: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    verdict: 'SAFE',
    flags: 0,
    weight: 1,
    safeOrdinal: index + 1,
    shortProof: 'source verified',
    evidenceURI: uri,
    txHash: `0x${'33'.repeat(32)}`,
    at: '2026-11-25T03:00:00.000Z',
    settled: true,
    castDuringDispute: false,
  }
}

function answer(items: unknown[], total: number, finalizedBlock: string, page = 1) {
  return new Response(
    JSON.stringify({
      success: true,
      data: { items },
      meta: { finalizedBlock, page: { total, page, limit: 100 } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('the evidence of a target, read from the internal service', () => {
  beforeEach(() => {
    process.env.INTERNAL_URL = 'https://internal.example.com'
    process.env.INTERNAL_KEY = 'test-only-key'
    fetchMock.mockReset()
  })

  afterEach(() => {
    delete process.env.INTERNAL_URL
    delete process.env.INTERNAL_KEY
  })

  test('the request goes to the route of the votes, with the key of the internal service', async () => {
    fetchMock.mockResolvedValue(answer([row(0, 'ipfs://one')], 1, '12345'))

    const indexed = await readIndexedEvidence(TARGET)

    expect(indexed?.rows).toEqual([
      { index: 0, shortProof: 'source verified', evidenceURI: 'ipfs://one', txHash: `0x${'33'.repeat(32)}` },
    ])
    expect(indexed?.finalizedBlock).toBe(12345n)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://internal.example.com/targets/${TARGET}/attestations?page=1&limit=100`)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-only-key')
  })

  test('every page of the votes is read, so no vote is left out', async () => {
    fetchMock
      .mockResolvedValueOnce(answer([row(0, 'ipfs://one')], 2, '12345', 1))
      .mockResolvedValueOnce(answer([row(1, 'ipfs://two')], 2, '12345', 2))

    const indexed = await readIndexedEvidence(TARGET)

    expect(indexed?.rows.map(item => item.evidenceURI)).toEqual(['ipfs://one', 'ipfs://two'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toContain('page=2')
  })

  test('without an internal service the chain reads the log itself', async () => {
    delete process.env.INTERNAL_URL

    expect(await readIndexedEvidence(TARGET)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a service that cannot be reached reads nothing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    expect(await readIndexedEvidence(TARGET)).toBeNull()
  })

  test('a service that refuses the request reads nothing', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))

    expect(await readIndexedEvidence(TARGET)).toBeNull()
  })

  test('an answer that does not fit the read model reads nothing', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { items: [{ index: 'one' }] }, meta: {} }), { status: 200 }),
    )

    expect(await readIndexedEvidence(TARGET)).toBeNull()
  })

  test('an answer without the block it was read at reads nothing', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { items: [row(0, 'ipfs://one')] },
          meta: { page: { total: 1, page: 1, limit: 100 } },
        }),
        { status: 200 },
      ),
    )

    expect(await readIndexedEvidence(TARGET)).toBeNull()
  })
})
