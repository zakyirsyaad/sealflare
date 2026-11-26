import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pinEvidence, UploadFailedError, UploadOutcomeUnknownError } from '../server/pinata'

const JWT = 'a-jwt-value'
const BYTES = new TextEncoder().encode('{"report":"evidence"}')

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

function answer(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('the evidence is pinned on the API of Pinata', () => {
  beforeEach(() => {
    process.env.PINATA_JWT = JWT
    fetchMock.mockReset()
  })

  afterEach(() => {
    delete process.env.PINATA_JWT
  })

  test('the request goes to the route of the API, with the bytes of the report as they are', async () => {
    fetchMock.mockResolvedValue(answer(200, { IpfsHash: 'bafycid' }))

    const uri = await pinEvidence(BYTES)

    expect(uri).toBe('ipfs://bafycid')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.pinata.cloud/pinning/pinFileToIPFS')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${JWT}`)
    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    const file = form.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as File).name).toBe('evidence.json')
    expect((file as Blob).type).toBe('application/json')
    expect((file as Blob).size).toBe(BYTES.length)
    expect(JSON.parse(String(form.get('pinataMetadata')))).toEqual({ name: 'sealflare-evidence' })
  })

  test('a refusal of the storage is a refusal, so the request may be signed again', async () => {
    fetchMock.mockResolvedValue(answer(401, { error: 'bad key' }))

    await expect(pinEvidence(BYTES)).rejects.toBeInstanceOf(UploadFailedError)
  })

  test('a failure of the storage has an unknown outcome, so the reservation stays', async () => {
    fetchMock.mockResolvedValue(answer(502, { error: 'bad gateway' }))

    await expect(pinEvidence(BYTES)).rejects.toBeInstanceOf(UploadOutcomeUnknownError)
    await expect(pinEvidence(BYTES)).rejects.not.toBeInstanceOf(UploadFailedError)
  })

  test('an answer that does not name a file has an unknown outcome too', async () => {
    fetchMock.mockResolvedValue(answer(200, { something: 'else' }))

    await expect(pinEvidence(BYTES)).rejects.toBeInstanceOf(UploadOutcomeUnknownError)
  })

  test('a storage that cannot be reached has an unknown outcome', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(pinEvidence(BYTES)).rejects.toBeInstanceOf(UploadOutcomeUnknownError)
  })

  test('without a key nothing is sent, so the request is a refusal', async () => {
    delete process.env.PINATA_JWT

    await expect(pinEvidence(BYTES)).rejects.toBeInstanceOf(UploadFailedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
