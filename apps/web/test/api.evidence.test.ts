import { describe, expect, beforeEach, test, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { API_EIP712, evidenceHashOf } from '@sealflare/shared/schemas'

const { internalGet, internalPost } = vi.hoisted(() => ({ internalGet: vi.fn(), internalPost: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalGet, internalPost }
})

const reader = vi.hoisted(() => ({ isAgentIdHolder: vi.fn(), tierAt: vi.fn(), blockNumber: vi.fn() }))
vi.mock('../server/chain', () => ({ getChainReader: () => reader }))

const { pin, UploadFailedError, pinataKey } = vi.hoisted(() => {
  class UploadFailedError extends Error {}
  return { pin: vi.fn(), UploadFailedError, pinataKey: vi.fn() }
})
vi.mock('../server/pinata', () => ({ pinEvidence: pin, UploadFailedError, pinataKey }))

const takeRateLimit = vi.hoisted(() => vi.fn())
vi.mock('../server/rate', () => ({ takeRateLimit }))

const { POST: postEvidence } = await import('../app/api/evidence/route')

/** The bytes of a text, the same bytes the API hashes and pins. */
function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

const holder = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const stranger = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const TARGET_ID = `0x${'11'.repeat(32)}`
const CHAIN_ID = 56

function reportFor(author: string) {
  return {
    schemaVersion: 1,
    kind: 'attestation',
    targetId: TARGET_ID,
    author,
    createdAt: '2026-11-25T03:00:00.000Z',
    flags: 0,
    shortProof: 'a short proof',
  }
}

async function signedRequest(options: {
  signer?: typeof holder
  author?: string
  nonce?: string
  expiry?: string
  reportJson?: string
  signature?: string
} = {}) {
  const signer = options.signer ?? holder
  const reportJson = options.reportJson ?? JSON.stringify(reportFor(options.author ?? signer.address))
  const expiry = options.expiry ?? String(Math.floor(Date.now() / 1000) + 300)
  const nonce = options.nonce ?? '424242'
  const evidenceHash = evidenceHashOf(utf8Bytes(reportJson))
  const signature =
    options.signature ??
    (await signer.signTypedData({
      domain: { name: API_EIP712.domain.name, version: API_EIP712.domain.version, chainId: CHAIN_ID },
      types: { EvidenceUpload: [...API_EIP712.types.EvidenceUpload] },
      primaryType: 'EvidenceUpload',
      message: { evidenceHash, nonce: BigInt(nonce), expiry: BigInt(expiry) },
    }))
  return { reportJson, address: signer.address, nonce, expiry, signature }
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/evidence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function answer(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

describe('the evidence API', () => {
  beforeEach(() => {
    internalGet.mockReset()
    internalPost.mockReset()
    pin.mockReset()
    pinataKey.mockReset()
    pinataKey.mockReturnValue('test-key')
    takeRateLimit.mockReset()
    reader.isAgentIdHolder.mockReset()
    reader.isAgentIdHolder.mockResolvedValue(true)
    takeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
    pin.mockResolvedValue('ipfs://bafycid')
    internalPost.mockImplementation(async (path: string) => {
      if (path === '/nonce/use') return { data: { fresh: true }, meta: {} }
      return { data: { committed: true, released: true }, meta: {} }
    })
  })

  test('a correctly signed report is pinned byte for byte and its hash is returned', async () => {
    const body = await signedRequest()
    const response = await postEvidence(request(body))
    expect(response.status).toBe(200)
    const answerBody = await answer(response)
    expect(answerBody.success).toBe(true)
    expect(answerBody.data.evidenceURI).toBe('ipfs://bafycid')
    expect(answerBody.data.evidenceHash).toBe(evidenceHashOf(utf8Bytes(body.reportJson)))
    const pinned = pin.mock.calls[0]?.[0] as Uint8Array
    expect(new TextDecoder().decode(pinned)).toBe(body.reportJson)
  })

  test('a successful upload reserves the nonce and then commits it', async () => {
    await postEvidence(request(await signedRequest()))
    const paths = internalPost.mock.calls.map(call => call[0])
    expect(paths).toEqual(['/nonce/use', '/nonce/commit'])
  })

  test.each([
    ['a signature by another address', 'SIGNATURE_INVALID'],
    ['an expired expiry', 'SIGNATURE_EXPIRED'],
    ['a signer without an Agent ID', 'NOT_AGENT_ID_HOLDER'],
    ['an author different from the signer', 'SIGNATURE_INVALID'],
  ])('%s is refused with %s and nothing is pinned', async (caseName, code) => {
    let body: Record<string, unknown>
    if (caseName === 'a signature by another address') {
      body = await signedRequest({ signer: holder })
      body.signature = await stranger.signTypedData({
        domain: { name: API_EIP712.domain.name, version: API_EIP712.domain.version, chainId: CHAIN_ID },
        types: { EvidenceUpload: [...API_EIP712.types.EvidenceUpload] },
        primaryType: 'EvidenceUpload',
        message: { evidenceHash: evidenceHashOf(utf8Bytes(body.reportJson as string)), nonce: 424242n, expiry: BigInt(body.expiry as string) },
      })
    } else if (caseName === 'an expired expiry') {
      const expiry = String(Math.floor(Date.now() / 1000) - 60)
      body = await signedRequest({ expiry })
    } else if (caseName === 'a signer without an Agent ID') {
      reader.isAgentIdHolder.mockResolvedValue(false)
      body = await signedRequest()
    } else {
      body = await signedRequest({ author: stranger.address })
    }
    const response = await postEvidence(request(body))
    expect(response.status).toBeGreaterThanOrEqual(400)
    const answerBody = await answer(response)
    expect(answerBody.success).toBe(false)
    expect(answerBody.error.code).toBe(code)
    expect(pin).not.toHaveBeenCalled()
  })

  test('a replayed nonce is refused and nothing is pinned', async () => {
    internalPost.mockImplementation(async (path: string) => {
      if (path === '/nonce/use') return { data: { fresh: false }, meta: {} }
      return { data: {}, meta: {} }
    })
    const response = await postEvidence(request(await signedRequest()))
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('SIGNATURE_INVALID')
    expect(pin).not.toHaveBeenCalled()
  })

  test('a report above the size limit is BAD_REQUEST', async () => {
    const reportJson = JSON.stringify({ ...reportFor(holder.address), statement: 'x'.repeat(300_000) })
    const response = await postEvidence(request(await signedRequest({ reportJson })))
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(pin).not.toHaveBeenCalled()
  })

  test('a body that is not JSON, or fails the schema, is BAD_REQUEST', async () => {
    for (const body of ['not json', {}, { reportJson: '{}' }]) {
      const response = await postEvidence(request(body))
      expect(response.status).toBe(400)
      expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    }
    expect(pin).not.toHaveBeenCalled()
  })

  test('a Pinata failure is UPLOAD_FAILED and the nonce is given back', async () => {
    pin.mockRejectedValue(new UploadFailedError())
    const response = await postEvidence(request(await signedRequest()))
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('UPLOAD_FAILED')
    const paths = internalPost.mock.calls.map(call => call[0])
    expect(paths).toEqual(['/nonce/use', '/nonce/release'])
  })

  test('a deployment without a storage key refuses the upload and holds no reservation', async () => {
    pinataKey.mockImplementation(() => {
      throw new Error('PINATA_JWT is not set')
    })
    const response = await postEvidence(request(await signedRequest()))
    expect(response.status).toBeGreaterThanOrEqual(400)
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(pin).not.toHaveBeenCalled()
    expect(internalPost).not.toHaveBeenCalled()
  })

  test('an upload that failed in an unknown way keeps the reservation', async () => {
    pin.mockRejectedValue(new Error('the socket closed'))
    await postEvidence(request(await signedRequest()))
    const paths = internalPost.mock.calls.map(call => call[0])
    expect(paths).not.toContain('/nonce/release')
  })

  test('more than thirty uploads in an hour are refused', async () => {
    takeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 })
    const response = await postEvidence(request(await signedRequest()))
    const body = await answer(response)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.details.retryAfterSeconds).toBe(120)
    expect(pin).not.toHaveBeenCalled()
  })
})
