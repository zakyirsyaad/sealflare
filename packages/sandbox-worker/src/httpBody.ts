import { CONSTANTS } from '@sealflare/shared/rules'
import { WorkerRunRequest } from '@sealflare/shared/schemas'
import { PROBE_SET_VERSION } from './probes'
import { RunId } from './store'

export class RequestError extends Error {
  constructor(readonly status: 400 | 413, message: string) { super(message) }
}
const MAX_BODY = CONSTANTS.MAX_SKILL_MD_BYTES * 6 + 8192

/** Count actual bytes even if Content-Length is missing or dishonest. */
export async function readRunRequest(request: Request): Promise<WorkerRunRequest> {
  const reader = request.body?.getReader(), bytes = new Uint8Array(MAX_BODY)
  let length = 0
  try {
    if (!reader) throw new RequestError(400, 'Invalid run request.')
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > MAX_BODY) throw new RequestError(413, 'Run request is too large.')
      bytes.set(chunk.value, length - chunk.value.length)
    }
    const parsed = WorkerRunRequest.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))))
    RunId.parse(parsed.runId)
    if (parsed.probeSetVersion !== PROBE_SET_VERSION) throw new RequestError(400, 'Unsupported probe set version.')
    return parsed
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(400, 'Invalid run request.')
  } finally { if (reader) void reader.cancel().catch(() => {}) }
}
