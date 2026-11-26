import { z } from 'zod'
import {
  SandboxQuotaResponse,
  SandboxRunCreateResponse,
  SandboxRunStatusResponse,
  ScanReport,
  SandboxRunCreateRequest,
} from '@sealflare/shared/schemas'

/** Every failure the public API can report. `code` is the machine name, `message` is for people. */
export class ApiError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

const Answer = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
})

async function post<T>(path: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('INTERNAL', 'The scan service could not be reached.')
  }
  const payload = await response.json().catch(() => null)
  const answer = Answer.safeParse(payload)
  if (!answer.success) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
  if (!answer.data.success) {
    const error = answer.data.error
    if (!error) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
    throw new ApiError(error.code, error.message, error.details)
  }
  const parsed = parse(answer.data.data)
  return parsed
}

/**
 * A call that only reads.
 *
 * The answer is read with the frozen schema of the route, so a field that changed its shape is
 * refused here instead of reaching the screen.
 */
async function get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { method: 'GET' })
  } catch {
    throw new ApiError('INTERNAL', 'The sandbox service could not be reached.')
  }
  const payload = await response.json().catch(() => null)
  const answer = Answer.safeParse(payload)
  if (!answer.success) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
  if (!answer.data.success) {
    const error = answer.data.error
    if (!error) throw new ApiError('INTERNAL', 'The server sent an answer that could not be read.')
    throw new ApiError(error.code, error.message, error.details)
  }
  return parse(answer.data.data)
}

function report(value: unknown): ScanReport {
  const parsed = ScanReport.safeParse(value)
  if (!parsed.success) throw new ApiError('INTERNAL', 'The scan result could not be read.')
  return parsed.data
}

/** The data of the success branch of an envelope. */
type EnvelopeData<T> = T extends { success: true; data: infer D } ? D : never

/** The run the API reports after it was queued. */
export type CreatedRun = EnvelopeData<z.infer<typeof SandboxRunCreateResponse>>

/** The state of a run, as the API reports it. */
export type RunState = EnvelopeData<z.infer<typeof SandboxRunStatusResponse>>

/** The runs an address has left today. */
export type Quota = EnvelopeData<z.infer<typeof SandboxQuotaResponse>>

function createdRun(value: unknown): CreatedRun {
  const parsed = SandboxRunCreateResponse.safeParse({ success: true, data: value })
  if (!parsed.success || !parsed.data.success) {
    throw new ApiError('INTERNAL', 'The sandbox run could not be read.')
  }
  return parsed.data.data
}

function runState(value: unknown): RunState {
  const parsed = SandboxRunStatusResponse.safeParse({ success: true, data: value })
  if (!parsed.success || !parsed.data.success) {
    throw new ApiError('INTERNAL', 'The sandbox run could not be read.')
  }
  return parsed.data.data
}

function quota(value: unknown): Quota {
  const parsed = SandboxQuotaResponse.safeParse({ success: true, data: value })
  if (!parsed.success || !parsed.data.success) {
    throw new ApiError('INTERNAL', 'The sandbox quota could not be read.')
  }
  return parsed.data.data
}

/** The public API, called from the browser. Every answer arrives in an envelope. */
export const api = {
  scanContract(address: string): Promise<ScanReport> {
    return post('/api/scan/contract', { address }, report)
  },
  scanSkill(url: string, path?: string): Promise<ScanReport> {
    return post('/api/scan/skill', path === undefined ? { url } : { url, path }, report)
  },
  /** Queues a run of a skill. The request carries the signature of the Agent ID holder. */
  sandboxRun(request: z.infer<typeof SandboxRunCreateRequest>): Promise<CreatedRun> {
    return post('/api/sandbox/runs', request, createdRun)
  },
  /** The state of a run. */
  sandboxRunStatus(runId: string): Promise<RunState> {
    return get(`/api/sandbox/runs/${encodeURIComponent(runId)}`, runState)
  },
  /** The runs an address has left today. */
  sandboxQuota(address: string): Promise<Quota> {
    return get(`/api/sandbox/quota/${address}`, quota)
  },
}
