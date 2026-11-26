import { recoverTypedDataAddress, type Address } from 'viem'
import { API_EIP712, SandboxRunCreateRequest } from '@sealflare/shared/schemas'
import { expectedChainId } from '../../../../lib/chain/config'
import { fail, failUnexpected, ok } from '../../../../server/respond'
import { internalPost, InternalServiceError } from '../../../../server/internal'
import { getChainReader } from '../../../../server/chain'

/** A signed request may not live longer than ten minutes, and never further ahead than that. */
const MAX_EXPIRY_SECONDS = 600n

/**
 * How long this route waits for the internal service.
 *
 * The internal service reads the chain, fetches the skill of the bundle and then queues the run.
 * The call waits longer than the other ones, so a run that was queued reaches the client with its
 * id. A run that is queued but never announced would hold a slot of the quota for good.
 */
const INTERNAL_TIMEOUT_MS = 30_000

/** The status every refusal of the internal service is answered with. */
const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  SIGNATURE_INVALID: 401,
  SIGNATURE_EXPIRED: 401,
  NOT_AGENT_ID_HOLDER: 403,
  QUOTA_EXHAUSTED: 429,
  SANDBOX_PAUSED: 429,
  RUN_NOT_FOUND: 404,
  INTERNAL: 500,
}

/**
 * Queues a run of a skill.
 *
 * The signature and the Agent ID are checked here, and the internal service checks them again on
 * its own. A valid inter-service key is not a proof of anything, so the service never takes the
 * word of the caller.
 *
 * The nonce of the request is reserved by the internal service, not here: the service is the one
 * that queues the run, so it is the one that gives the nonce back when the run is refused.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const parsed = SandboxRunCreateRequest.safeParse(body)
  if (!parsed.success) return fail('BAD_REQUEST', 'The sandbox request is not valid.', 400)
  const run = parsed.data

  const refused = await refuseUnsigned(run)
  if (refused !== null) return refused
  const holder = await checkHolder(run.address)
  if (holder !== null) return holder

  try {
    const answer = await internalPost<unknown>('/sandbox/runs', run, { timeoutMs: INTERNAL_TIMEOUT_MS })
    return ok(answer.data)
  } catch (error) {
    if (error instanceof InternalServiceError) {
      return fail(error.code, error.message, STATUS[error.code] ?? 500)
    }
    return failUnexpected('The sandbox run could not be queued.', error)
  }
}

/**
 * The checks on the signature itself: the signature belongs to the address, and the request has
 * not expired.
 */
async function refuseUnsigned(run: {
  bundleHash: `0x${string}`
  address: Address
  nonce: string
  expiry: string
  signature: `0x${string}`
}): Promise<Response | null> {
  const signer = await recoverSigner(run)
  if (signer === null || signer.toLowerCase() !== run.address.toLowerCase()) {
    return fail('SIGNATURE_INVALID', 'The signature does not belong to the address.', 401)
  }
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (BigInt(run.expiry) <= now) return fail('SIGNATURE_EXPIRED', 'The request has expired.', 401)
  if (BigInt(run.expiry) > now + MAX_EXPIRY_SECONDS) {
    return fail('BAD_REQUEST', 'The request expires too far in the future.', 400)
  }
  return null
}

/** Only an address that holds an Agent ID may run a sandbox. */
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

/** The address that signed the run, or null when the signature cannot be recovered. */
async function recoverSigner(run: {
  bundleHash: `0x${string}`
  nonce: string
  expiry: string
  signature: `0x${string}`
}): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: { ...API_EIP712.domain, chainId: expectedChainId },
      types: { SandboxRun: [...API_EIP712.types.SandboxRun] },
      primaryType: 'SandboxRun',
      message: { bundleHash: run.bundleHash, nonce: BigInt(run.nonce), expiry: BigInt(run.expiry) },
      signature: run.signature,
    })
  } catch {
    return null
  }
}
