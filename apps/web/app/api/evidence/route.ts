import { recoverTypedDataAddress, type Address } from 'viem'
import { API_EIP712, EvidenceReport, EvidenceRequest, evidenceHashOf } from '@sealflare/shared/schemas'
import { expectedChainId } from '../../../lib/chain/config'
import { fail, failUnexpected, ok } from '../../../server/respond'
import { internalPost, InternalServiceError } from '../../../server/internal'
import { getChainReader } from '../../../server/chain'
import { pinEvidence, pinataKey, UploadFailedError, UploadOutcomeUnknownError } from '../../../server/pinata'
import { takeRateLimit } from '../../../server/rate'

/** A signed request may not live longer than ten minutes, and never further ahead than that. */
const MAX_EXPIRY_SECONDS = 600n

/** The fields of a signed evidence request. */
type Evidence = {
  reportJson: string
  address: Address
  nonce: string
  expiry: string
  signature: `0x${string}`
}

/**
 * Stores the evidence of an attestation.
 *
 * The bytes that are pinned are the bytes the client hashed into its signature, so the hash on
 * the chain and the report behind it are always the same document.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const parsed = EvidenceRequest.safeParse(body)
  if (!parsed.success) return fail('BAD_REQUEST', 'The evidence request is not valid.', 400)
  const evidence = parsed.data
  const bytes = new TextEncoder().encode(evidence.reportJson)
  const evidenceHash = evidenceHashOf(bytes)

  const refused = await refuseUnsigned(evidence, evidenceHash)
  if (refused !== null) return refused
  const holder = await checkHolder(evidence.address)
  if (holder !== null) return holder
  const limited = await checkRate(evidence.address)
  if (limited !== null) return limited
  const configured = checkStorage()
  if (configured !== null) return configured
  const reserved = await reserveNonce(evidence)
  if (reserved !== null) return reserved

  let evidenceURI: string
  try {
    evidenceURI = await pinEvidence(bytes)
  } catch (error) {
    if (error instanceof UploadFailedError) {
      // The upload was refused, so nothing was pinned and the request may be signed again.
      await releaseNonce(evidence.address, evidence.nonce)
      return fail('UPLOAD_FAILED', 'The evidence could not be stored.', 502)
    }
    if (error instanceof UploadOutcomeUnknownError) {
      // The file may be pinned, so the reservation stays. A blocked request can be signed again
      // later, and a replay cannot be undone.
      return fail('UPLOAD_FAILED', 'The evidence could not be stored.', 502)
    }
    // The outcome of the upload is unknown, so the reservation stays. A blocked request can be
    // signed again later, and a replay cannot be undone.
    return failUnexpected('The evidence could not be stored.', error)
  }
  await commitNonce(evidence.address, evidence.nonce)
  return ok({ evidenceURI, evidenceHash })
}

/**
 * The checks on the signature itself: the signature belongs to the address, the report is
 * written by that address, and the request has not expired.
 */
async function refuseUnsigned(evidence: Evidence, evidenceHash: `0x${string}`): Promise<Response | null> {
  const signer = await recoverSigner(evidenceHash, evidence.nonce, evidence.expiry, evidence.signature)
  if (signer === null || signer.toLowerCase() !== evidence.address.toLowerCase()) {
    return fail('SIGNATURE_INVALID', 'The signature does not belong to the address.', 401)
  }
  const report = readReport(evidence.reportJson)
  if (report === null || report.author.toLowerCase() !== evidence.address.toLowerCase()) {
    return fail('SIGNATURE_INVALID', 'The report is written by another address.', 401)
  }
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (BigInt(evidence.expiry) <= now) return fail('SIGNATURE_EXPIRED', 'The request has expired.', 401)
  if (BigInt(evidence.expiry) > now + MAX_EXPIRY_SECONDS) {
    return fail('BAD_REQUEST', 'The request expires too far in the future.', 400)
  }
  return null
}

/** Only an address that holds an Agent ID may upload evidence. */
async function checkHolder(address: Address): Promise<Response | null> {
  let holder: boolean
  try {
    holder = await getChainReader().isAgentIdHolder(address)
  } catch (error) {
    return failUnexpected('The registry could not be read.', error)
  }
  if (!holder) return fail('NOT_AGENT_ID_HOLDER', 'The address does not hold an Agent ID.', 403)
  return null
}

/** An address may not upload evidence without a limit. */
async function checkRate(address: Address): Promise<Response | null> {
  try {
    const limit = await takeRateLimit('evidence', address)
    if (!limit.allowed) {
      return fail('RATE_LIMITED', 'Too many evidence uploads.', 429, { retryAfterSeconds: limit.retryAfterSeconds })
    }
  } catch (error) {
    return failUnexpected('The rate limit could not be checked.', error)
  }
  return null
}

/**
 * The storage has to be usable before the nonce is reserved. A deployment without the key holds
 * no reservation, so nothing has to be given back later.
 */
function checkStorage(): Response | null {
  try {
    pinataKey()
  } catch (error) {
    return failUnexpected('The evidence could not be stored.', error)
  }
  return null
}

/**
 * Reserves the nonce of the request. A nonce that was used before is refused here, so a replay
 * never reaches the storage.
 */
async function reserveNonce(evidence: Evidence): Promise<Response | null> {
  let fresh: boolean
  try {
    const answer = await internalPost<{ fresh: boolean }>('/nonce/use', {
      address: evidence.address,
      nonce: evidence.nonce,
      expiry: evidence.expiry,
    })
    fresh = answer.data.fresh
  } catch (error) {
    if (error instanceof InternalServiceError && error.code === 'BAD_REQUEST') {
      return fail('BAD_REQUEST', 'The request cannot be used.', 400)
    }
    return failUnexpected('The request could not be reserved.', error)
  }
  if (!fresh) return fail('SIGNATURE_INVALID', 'The request was already used.', 401)
  return null
}

/** The address that signed the upload, or null when the signature cannot be recovered. */
async function recoverSigner(
  evidenceHash: `0x${string}`,
  nonce: string,
  expiry: string,
  signature: `0x${string}`,
): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: { ...API_EIP712.domain, chainId: expectedChainId },
      types: { EvidenceUpload: [...API_EIP712.types.EvidenceUpload] },
      primaryType: 'EvidenceUpload',
      message: { evidenceHash, nonce: BigInt(nonce), expiry: BigInt(expiry) },
      signature,
    })
  } catch {
    return null
  }
}

/** The report of the request, or null when it cannot be read. */
function readReport(reportJson: string): EvidenceReport | null {
  try {
    const parsed = EvidenceReport.safeParse(JSON.parse(reportJson))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Marks the nonce as spent, so the request can never be used again. */
async function commitNonce(address: Address, nonce: string): Promise<void> {
  try {
    await internalPost('/nonce/commit', { address, nonce })
  } catch {
    // The nonce stays reserved, and a reserved nonce refuses a replay just like a spent one.
  }
}

/** Gives a reservation back, so the request can be signed again. */
async function releaseNonce(address: Address, nonce: string): Promise<void> {
  try {
    await internalPost('/nonce/release', { address, nonce })
  } catch {
    // The reservation stays. A request that may be signed again is not worth failing over.
  }
}
