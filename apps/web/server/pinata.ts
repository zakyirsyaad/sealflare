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

const PINATA_URL = 'https://uploads.pinata.cloud/pinning/pinFileToIPFS'
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
 */
export async function pinEvidence(bytes: Uint8Array): Promise<string> {
  let jwt: string
  try {
    jwt = pinataKey()
  } catch {
    // Without a key nothing is sent, so this is a refusal and not an unknown outcome.
    throw new UploadFailedError()
  }
  const form = new FormData()
  form.append('file', new Blob([bytes.slice()], { type: 'application/json' }), 'evidence.json')
  form.append('pinataMetadata', JSON.stringify({ name: 'sealflare-evidence' }))
  const response = await fetch(PINATA_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new UploadFailedError()
  const body = (await response.json().catch(() => null)) as { IpfsHash?: unknown } | null
  const cid = body?.IpfsHash
  if (typeof cid !== 'string' || cid.length === 0) throw new UploadFailedError()
  return `ipfs://${cid}`
}
