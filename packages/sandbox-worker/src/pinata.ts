// API checked 2026-11-25: https://docs.pinata.cloud/files/uploading-files
// Public file endpoint preserves supplied bytes; pinJSONToIPFS may reserialize JSON.
import { z } from 'zod'
import { withDeadline } from './deadline'

const Reply = z.object({ data: z.object({ cid: z.string().max(200).regex(/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{30,})$/) }) })
const MAX_JSON_BYTES = 16_777_216, MAX_RESPONSE_BYTES = 65_536

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); throw Error('Upload failed.') }
  const reader = response.body.getReader(), bytes = new Uint8Array(MAX_RESPONSE_BYTES)
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  let length = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > MAX_RESPONSE_BYTES) throw Error('Upload response is too large.')
      bytes.set(chunk.value, length - chunk.value.length)
    }
    signal.throwIfAborted()
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}) }
}

export function createPinataUploader(options: { jwt: string; fetch?: typeof fetch; timeoutMs?: number }): (json: string) => Promise<string> {
  const jwt = z.string().min(1).max(8192).regex(/^\S+$/).parse(options.jwt), fetcher = options.fetch ?? fetch
  const timeout = z.number().int().min(1).max(120_000).parse(options.timeoutMs ?? 30_000)
  return async (json) => {
    try {
      if (!json.isWellFormed() || Buffer.byteLength(json) > MAX_JSON_BYTES) throw Error('Invalid upload size.')
      z.json().parse(JSON.parse(json))
      const form = new FormData()
      form.append('file', new File([json], 'sandbox.json', { type: 'application/json' }))
      form.append('network', 'public')
      const reply = await withDeadline(async (signal) => {
        const response = await fetcher('https://uploads.pinata.cloud/v3/files', { method: 'POST',
          headers: { authorization: `Bearer ${jwt}` }, body: form, signal, redirect: 'error' })
        return Reply.parse(await responseJson(response, signal))
      }, timeout)
      return `ipfs://${reply.data.cid}`
    } catch { throw Error('Evidence upload failed.') }
  }
}
