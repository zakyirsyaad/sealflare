import { WorkerRunRequest, WorkerRunResponse, WorkerRunStatus } from '@sealflare/shared/schemas'

/**
 * The client of the sandbox worker.
 *
 * The worker runs on the same host and never opens a connection back, so nothing a skill injects
 * can steer it toward Postgres or the internal service. Every request carries the inter-service
 * key of the worker.
 */
export interface WorkerClient {
  /** Starts a run. Throws `WorkerRefused` when the worker refuses it. */
  start(request: WorkerRunRequest): Promise<void>
  /** The status of a run, or null when the worker does not know it. */
  status(runId: string): Promise<WorkerRunStatus | null>
}

/** The two reasons the worker refuses a run. */
export type WorkerRefusal = 'DAILY_LIMIT' | 'BUSY'

/**
 * The worker refused the run. `DAILY_LIMIT` means the daily cost limit of the worker is reached,
 * `BUSY` means another run is in progress.
 */
export class WorkerRefused extends Error {
  readonly reason: WorkerRefusal

  constructor(reason: WorkerRefusal) {
    super(`The sandbox worker refused the run: ${reason}.`)
    this.name = 'WorkerRefused'
    this.reason = reason
  }
}

/** The worker could not be reached, or answered something that cannot be read. */
export class WorkerUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerUnavailable'
  }
}

export interface WorkerClientOptions {
  url: string
  key: string
  fetch?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

function baseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

/**
 * The client of the worker over HTTP.
 *
 * A refusal is a normal answer and not a failure of the call: the worker answers 429 with the
 * reason. Every other status is an infrastructure failure, because the run did not start.
 */
export function createWorkerClient(options: WorkerClientOptions): WorkerClient {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${options.key}`)
    try {
      return await doFetch(`${baseUrl(options.url)}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new WorkerUnavailable('The sandbox worker could not be reached.')
    }
  }

  return {
    async start(request: WorkerRunRequest): Promise<void> {
      const response = await call('/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WorkerRunRequest.parse(request)),
      })
      if (response.status === 429) {
        const parsed = WorkerRunResponse.safeParse(await response.json().catch(() => null))
        const reason = parsed.success && !parsed.data.accepted ? parsed.data.reason : 'BUSY'
        throw new WorkerRefused(reason)
      }
      if (response.status !== 202) {
        throw new WorkerUnavailable('The sandbox worker did not accept the run.')
      }
    },

    async status(runId: string): Promise<WorkerRunStatus | null> {
      const response = await call(`/runs/${encodeURIComponent(runId)}`, { method: 'GET' })
      if (response.status === 404) return null
      if (response.status !== 200) {
        throw new WorkerUnavailable('The sandbox worker did not answer with a status.')
      }
      const parsed = WorkerRunStatus.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new WorkerUnavailable('The sandbox worker sent a status that could not be read.')
      return parsed.data
    },
  }
}
