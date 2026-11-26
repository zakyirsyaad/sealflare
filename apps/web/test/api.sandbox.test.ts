import { describe, expect, beforeEach, test, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { API_EIP712 } from '@sealflare/shared/schemas'

const { internalPost, internalRead } = vi.hoisted(() => ({ internalPost: vi.fn(), internalRead: vi.fn() }))
vi.mock('../server/internal', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/internal')>()
  return { ...actual, internalPost, internalRead }
})

const reader = vi.hoisted(() => ({ isAgentIdHolder: vi.fn() }))
vi.mock('../server/chain', () => ({ getChainReader: () => reader }))

const { POST: postRun } = await import('../app/api/sandbox/runs/route')
const { GET: getRun } = await import('../app/api/sandbox/runs/[id]/route')
const { GET: getQuota } = await import('../app/api/sandbox/quota/[address]/route')

const holder = privateKeyToAccount(`0x${'44'.repeat(32)}`)
const stranger = privateKeyToAccount(`0x${'55'.repeat(32)}`)
const CHAIN_ID = 56
const BUNDLE = `0x${'ab'.repeat(32)}` as const
const SRC = `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`
const RUN_ID = `run_${'12'.repeat(12)}`

/** A request for a run, signed by the address that holds an Agent ID. */
async function signedRequest(overrides: { address?: string; expiry?: string; signature?: string } = {}) {
  const expiry = overrides.expiry ?? String(Math.floor(Date.now() / 1000) + 300)
  const nonce = '424242'
  const signature =
    overrides.signature ??
    (await holder.signTypedData({
      domain: { name: API_EIP712.domain.name, version: API_EIP712.domain.version, chainId: CHAIN_ID },
      types: { SandboxRun: [...API_EIP712.types.SandboxRun] },
      primaryType: 'SandboxRun',
      message: { bundleHash: BUNDLE, nonce: BigInt(nonce), expiry: BigInt(expiry) },
    }))
  return {
    bundleHash: BUNDLE,
    src: SRC,
    address: overrides.address ?? holder.address,
    nonce,
    expiry,
    signature,
  }
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/sandbox/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function answer(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>
}

describe('the sandbox API', () => {
  beforeEach(() => {
    internalPost.mockReset()
    internalRead.mockReset()
    reader.isAgentIdHolder.mockReset()
    reader.isAgentIdHolder.mockResolvedValue(true)
    internalPost.mockResolvedValue({
      data: { runId: RUN_ID, status: 'queued', queuePosition: 1, quotaLeft: 4 },
      meta: {},
    })
    internalRead.mockResolvedValue({ data: { runId: RUN_ID, status: 'queued', queuePosition: 1 }, meta: {} })
  })

  test('a request that does not match the schema is refused', async () => {
    const response = await postRun(request({ bundleHash: 'nope' }))
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(internalPost).not.toHaveBeenCalled()
  })

  test('a signed request is queued by the internal service and the run comes back', async () => {
    const response = await postRun(request(await signedRequest()))
    expect(response.status).toBe(200)
    const body = await answer(response)
    expect(body.success).toBe(true)
    expect(body.data.runId).toBe(RUN_ID)
    expect(body.data.quotaLeft).toBe(4)
    expect(internalPost).toHaveBeenCalledWith(
      '/sandbox/runs',
      expect.objectContaining({ bundleHash: BUNDLE }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  test('a signature by another address is refused and nothing is queued', async () => {
    const body = await signedRequest()
    body.signature = await stranger.signTypedData({
      domain: { name: API_EIP712.domain.name, version: API_EIP712.domain.version, chainId: CHAIN_ID },
      types: { SandboxRun: [...API_EIP712.types.SandboxRun] },
      primaryType: 'SandboxRun',
      message: { bundleHash: BUNDLE, nonce: BigInt(body.nonce), expiry: BigInt(body.expiry) },
    })
    const response = await postRun(request(body))
    expect(response.status).toBe(401)
    expect((await answer(response)).error.code).toBe('SIGNATURE_INVALID')
    expect(internalPost).not.toHaveBeenCalled()
  })

  test('an expired request is refused', async () => {
    const body = await signedRequest({ expiry: String(Math.floor(Date.now() / 1000) - 60) })
    const response = await postRun(request(body))
    expect(response.status).toBe(401)
    expect((await answer(response)).error.code).toBe('SIGNATURE_EXPIRED')
    expect(internalPost).not.toHaveBeenCalled()
  })

  test('an address without an Agent ID is refused', async () => {
    reader.isAgentIdHolder.mockResolvedValue(false)
    const response = await postRun(request(await signedRequest()))
    expect(response.status).toBe(403)
    expect((await answer(response)).error.code).toBe('NOT_AGENT_ID_HOLDER')
    expect(internalPost).not.toHaveBeenCalled()
  })

  test('a paused sandbox is answered with 429', async () => {
    const { InternalServiceError } = await import('../server/internal')
    internalPost.mockRejectedValue(new InternalServiceError('SANDBOX_PAUSED', 'The sandbox is paused for today.'))
    const response = await postRun(request(await signedRequest()))
    expect(response.status).toBe(429)
    expect((await answer(response)).error.code).toBe('SANDBOX_PAUSED')
  })

  test('a run that does not exist is a 404', async () => {
    const { InternalServiceError } = await import('../server/internal')
    internalRead.mockRejectedValue(new InternalServiceError('RUN_NOT_FOUND', 'There is no such run.'))
    const response = await getRun(new Request('http://localhost'), { params: Promise.resolve({ id: RUN_ID }) })
    expect(response.status).toBe(404)
    expect((await answer(response)).error.code).toBe('RUN_NOT_FOUND')
  })

  test('an id that is not a run id is refused', async () => {
    const response = await getRun(new Request('http://localhost'), { params: Promise.resolve({ id: 'nope' }) })
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(internalRead).not.toHaveBeenCalled()
  })

  test('the state of a run is read from the internal service', async () => {
    const response = await getRun(new Request('http://localhost'), { params: Promise.resolve({ id: RUN_ID }) })
    expect(response.status).toBe(200)
    expect((await answer(response)).data.runId).toBe(RUN_ID)
    expect(internalRead).toHaveBeenCalledWith(`/sandbox/runs/${RUN_ID}`)
  })

  test('the quota of an address is read from the internal service', async () => {
    internalRead.mockResolvedValue({
      data: { left: 4, limit: 5, resetsAt: '2026-11-27T00:00:00.000Z' },
      meta: {},
    })
    const response = await getQuota(new Request('http://localhost'), {
      params: Promise.resolve({ address: holder.address }),
    })
    expect(response.status).toBe(200)
    expect((await answer(response)).data.left).toBe(4)
  })

  test('an address that is not an address is refused', async () => {
    const response = await getQuota(new Request('http://localhost'), {
      params: Promise.resolve({ address: 'nope' }),
    })
    expect(response.status).toBe(400)
    expect((await answer(response)).error.code).toBe('BAD_REQUEST')
    expect(internalRead).not.toHaveBeenCalled()
  })
})
