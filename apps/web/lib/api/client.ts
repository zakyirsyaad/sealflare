import { z } from 'zod'
import { ScanReport } from '@sealflare/shared/schemas'

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

async function post<T>(path: string, body: unknown, parse: (value: unknown) => T, unreachable = 'The scan service could not be reached.'): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('INTERNAL', unreachable)
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

function report(value: unknown): ScanReport {
  const parsed = ScanReport.safeParse(value)
  if (!parsed.success) throw new ApiError('INTERNAL', 'The scan result could not be read.')
  return parsed.data
}

const uploaded = z.object({ evidenceURI: z.string().min(1), evidenceHash: z.string().min(1) })

/** The public API, called from the browser. Every answer arrives in an envelope. */
export const api = {
  scanContract(address: string): Promise<ScanReport> {
    return post('/api/scan/contract', { address }, report)
  },
  scanSkill(url: string, path?: string): Promise<ScanReport> {
    return post('/api/scan/skill', path === undefined ? { url } : { url, path }, report)
  },
  /**
   * Stores the evidence of an attestation.
   *
   * `reportJson` is the exact text that was signed and hashed, so the report behind the hash on
   * the chain is the same document.
   */
  uploadEvidence(body: {
    reportJson: string
    address: string
    nonce: string
    expiry: string
    signature: string
  }): Promise<z.infer<typeof uploaded>> {
    return post('/api/evidence', body, value => {
      const parsed = uploaded.safeParse(value)
      if (!parsed.success) throw new ApiError('INTERNAL', 'The evidence answer could not be read.')
      return parsed.data
    }, 'The evidence service could not be reached.')
  },
}
