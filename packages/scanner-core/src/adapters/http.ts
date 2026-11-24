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

/** Deadline covers fetch and body decoding, including injected fetches that ignore abort. */
export async function requestJson(fetcher: typeof fetch, url: string, init: RequestInit,
  limit: number, timeoutMs = 5000,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = async () => {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: controller.signal })
    const body = response.ok ? await bodyJson(response, limit) : undefined
    if (!response.ok) void response.body?.cancel().catch(() => {})
    return { status: response.status, headers: response.headers, body }
  }
  try {
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('Request timed out.')) }, timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export function httpUrl(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw Error('Invalid HTTP URL.')
  return url
}
