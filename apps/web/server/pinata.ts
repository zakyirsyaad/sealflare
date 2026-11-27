import 'server-only'
import { parsePinataEnv } from '../lib/env.schema'

/**
 * Pinata refused the upload. Nothing was pinned, so the request may be signed again and the
 * nonce may be given back.
 */
export class UploadFailedError extends Error {
  constructor() {
    super('The upload was refused.')
    this.name = 'UploadFailedError'
  }
}

/**
 * The outcome of the upload is unknown.
 *
 * The storage may hold the file even though no answer came back, so the request may not be signed
 * again and the nonce stays reserved. A request that is refused twice pins the file twice, and a
 * nonce that is given back lets a replay through.
 */
export class UploadOutcomeUnknownError extends Error {
  constructor() {
    super('The outcome of the upload is unknown.')
    this.name = 'UploadOutcomeUnknownError'
  }
}

/**
 * The route of the API that pins a file.
 *
 * The API is served on `api.pinata.cloud`. The host `uploads.pinata.cloud` serves the files
 * endpoint of the third version of the API and answers 404 on this route, so every upload would
 * fail. A deployment may name another service, which is what the end-to-end suite does, so the
 * suite never reaches outside the machine.
 */
const TIMEOUT_MS = 30_000

/**
 * The key that lets the API store evidence.
 *
 * It is read before anything is reserved, so a deployment without a key never holds a
 * reservation it cannot use.
 */
export function pinataKey(): string {
  return parsePinataEnv(process.env).PINATA_JWT
}

/**
 * Pins the exact bytes of a report and returns the URI of them.
 *
 * The bytes are sent as they are. The hash on the chain is the hash of these bytes, so a report
 * that is re-serialised on the way would not match its own hash.
 *
 * A refusal of the storage, a 4xx, means that nothing was pinned. Every other failure means that
 * the outcome is unknown, so the caller keeps the reservation.
 */
export async function pinEvidence(bytes: Uint8Array): Promise<string> {
  let jwt: string
  let url: string
  try {
    const env = parsePinataEnv(process.env)
    jwt = env.PINATA_JWT
    url = env.PINATA_URL
  } catch {
    // Without a key nothing is sent, so this is a refusal and not an unknown outcome.
    throw new UploadFailedError()
  }
  const form = new FormData()
  form.append('file', new Blob([bytes.slice()], { type: 'application/json' }), 'evidence.json')
  form.append('pinataMetadata', JSON.stringify({ name: 'sealflare-evidence' }))
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // The request may have reached the storage, so the outcome is unknown.
    throw new UploadOutcomeUnknownError()
  }
  // A 4xx is a refusal of the request, so nothing was pinned. A 5xx is a failure of the storage,
  // and the file may be pinned even though no answer came back.
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) throw new UploadFailedError()
    throw new UploadOutcomeUnknownError()
  }
  const body = (await response.json().catch(() => null)) as { IpfsHash?: unknown } | null
  const cid = body?.IpfsHash
  if (typeof cid !== 'string' || cid.length === 0) {
    // The storage answered, but the answer does not name a file. The file may be pinned anyway.
    throw new UploadOutcomeUnknownError()
  }
  return `ipfs://${cid}`
}
