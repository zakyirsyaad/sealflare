import { afterEach, expect, test, vi } from 'vitest'
import { createPinataUploader } from '../src/pinata'

const jwt = 'fixture-upload-credential'
const cid = 'bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra'
const reply = () => new Response(JSON.stringify({ data: { id: 'fixture-id', name: 'sandbox.json', cid, size: 18, number_of_files: 1,
  mime_type: 'application/json', group_id: null } }))
afterEach(() => vi.useRealTimers())

test('public IPFS upload preserves the exact supplied JSON bytes rather than reserializing them', async () => {
  const json = ' {\n "value" : "🦭", "b": [1, 2] }\n'
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe('https://uploads.pinata.cloud/v3/files')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${jwt}`)
    const form = init?.body as FormData, file = form.get('file') as File
    expect(form.get('network')).toBe('public')
    expect(file.type).toBe('application/json')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new TextEncoder().encode(json))
    return reply()
  })
  expect(await createPinataUploader({ jwt, fetch: fetcher })(json)).toBe(`ipfs://${cid}`)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test.each([401, 403, 429, 500])('HTTP %s fails without revealing the JWT or response body', async (status) => {
  const upload = createPinataUploader({ jwt, fetch: async () => new Response(jwt, { status }) })
  await expect(upload('{}')).rejects.toThrow()
  await expect(upload('{}')).rejects.not.toThrow(jwt)
})

test('network exceptions are sanitized', async () => {
  const upload = createPinataUploader({ jwt, fetch: async () => { throw Error(jwt) } })
  await expect(upload('{}')).rejects.not.toThrow(jwt)
})

test.each(['not-json', '"\ud800"'])('invalid or non-UTF8 JSON source is rejected before network access', async (json) => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(createPinataUploader({ jwt, fetch: fetcher })(json)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

test.each([{ data: {} }, { data: { cid: 'https://example.invalid' } }, { data: { cid: '../bad' } }])
  ('malformed upload response is rejected', async (body) => {
    await expect(createPinataUploader({ jwt, fetch: async () => new Response(JSON.stringify(body)) })('{}')).rejects.toThrow()
  })

test('oversized response bytes are bounded before JSON parsing', async () => {
  const upload = createPinataUploader({ jwt, fetch: async () => new Response('x'.repeat(100_000)) })
  await expect(upload('{}')).rejects.toThrow()
})

test('redirect responses never forward credentials to another host', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 302, headers: { location: 'https://example.invalid/steal' } }))
  await expect(createPinataUploader({ jwt, fetch: fetcher })('{}')).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('the upload deadline covers a fetch that never settles', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const upload = createPinataUploader({ jwt, timeoutMs: 20, fetch: async (_url, init) => {
    signal = init?.signal ?? undefined
    return new Promise(() => {})
  } })
  const result = upload('{}').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(21)
  expect(await result).toBeInstanceOf(Error)
  expect(signal?.aborted).toBe(true)
})

test('the upload deadline also cancels a stalled response body', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const upload = createPinataUploader({ jwt, timeoutMs: 20, fetch: async () => new Response(new ReadableStream({ cancel })) })
  const result = upload('{}').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(21)
  expect(await result).toBeInstanceOf(Error)
  expect(cancel).toHaveBeenCalled()
})
