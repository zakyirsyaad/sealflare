export class ResponseTooLarge extends Error {}

async function bodyJson(response: Response, limit: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) throw new ResponseTooLarge('Response exceeds the size limit.')
  if (!response.body) throw Error('Missing response body.')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > limit) throw new ResponseTooLarge('Response exceeds the size limit.')
      chunks.push(chunk.value)
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(length)
  let cursor = 0
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

async function fetchResponse(fetcher: typeof fetch, input: string, init: RequestInit, followRedirects: boolean) {
  const origin = new URL(input).origin
  let url = input
  for (let hop = 0; ; hop++) {
    init.signal?.throwIfAborted()
    const response = await fetcher(url, { ...init, redirect: followRedirects ? 'manual' : 'error' })
    if (init.signal?.aborted) {
      void response.body?.cancel().catch(() => {})
      init.signal.throwIfAborted()
    }
    if (!followRedirects || ![301, 302, 303, 307, 308].includes(response.status)) return response
    void response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    if (hop === 3 || !location) throw Error('Invalid redirect.')
    const next = new URL(location, url)
    if (next.origin !== origin || next.username || next.password || next.hash) throw Error('Unsafe redirect.')
    url = next.toString()
  }
}

/** Deadline covers fetch and body decoding, even if the fetch ignores cancellation. */
export async function requestJson(fetcher: typeof fetch, url: string, init: RequestInit,
  limit: number, timeoutMs = 5000, followSameOriginRedirects = false,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cancellation = new Promise<never>((_resolve, reject) => {
    onAbort = () => { controller.abort(); reject(Error('Request cancelled.')) }
    if (init.signal?.aborted) onAbort()
    else init.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { controller.abort(); reject(Error('Request timed out.')) }, timeoutMs)
  })
  const work = async () => {
    const response = await fetchResponse(fetcher, url, { ...init, signal: controller.signal }, followSameOriginRedirects)
    const body = response.ok ? await bodyJson(response, limit) : undefined
    if (!response.ok) void response.body?.cancel().catch(() => {})
    return { status: response.status, headers: response.headers, body }
  }
  try {
    return await Promise.race([work(), cancellation])
  } finally {
    clearTimeout(timer)
    if (onAbort) init.signal?.removeEventListener('abort', onAbort)
    controller.abort()
  }
}

export function httpUrl(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('Invalid HTTP URL.')
  return url
}
