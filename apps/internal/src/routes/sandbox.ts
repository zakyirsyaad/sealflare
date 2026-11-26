import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { CONSTANTS } from '@sealflare/shared/rules'
import { AddressSchema, Bytes32Schema, SandboxRunCreateRequest, type SandboxResult } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, ok, type InternalErrorCode } from '../respond'
import { cacheGet } from '../sandbox/cache'
import type { ChainReader } from '../sandbox/chain'
import { isPaused } from '../sandbox/pause'
import { quotaLeft, resetsAt, takeQuota } from '../sandbox/quota'
import { enqueue, newRunId, readRun, type SandboxDeps } from '../sandbox/queue'
import { BundleMismatch, NotASkill, readReference, readSkillMd, SkillTooLarge, SkillUnavailable, type SkillDeps } from '../sandbox/skills'
import { readJson } from './json'
import { commitNonce, releaseNonce, reserveNonce, type NonceRefusal } from './nonce'

/**
 * The sandbox routes of the internal service.
 *
 * The internal service is the door to Postgres, and it is also the door to the sandbox. It checks
 * the signature and the Agent ID itself, so a request that reaches it over the inter-service key
 * is refused when it was signed by an address without an Agent ID, when the signature was used
 * before, or when it has expired.
 */
export interface SandboxRouteDeps {
  sql: Db
  now: () => Date
  chain: ChainReader
  skills: SkillDeps
  probeSetVersion: string
  modelId: string
}

/** The run the API reports after it was queued. */
interface CreatedRun {
  runId: string
  status: 'queued'
  queuePosition: number
  quotaLeft: number
}

/** A request that is refused, with the code and the status the answer carries. */
type FailureStatus = 400 | 403 | 429 | 500 | 502

interface Refusal {
  code: InternalErrorCode
  message: string
  status: FailureStatus
}

/** The address of the request, in the same shape as the address the chain answers with. */
function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** The sandbox routes. */
export function sandboxRoutes(deps: SandboxRouteDeps): Hono {
  const app = new Hono()

  app.post('/runs', (c) => createRun(c, deps))
  app.get('/runs/:runId', (c) => runStatus(c, deps))
  app.get('/quota/:address', (c) => quotaStatus(c, deps))
  app.get('/cache/:bundleHash', (c) => cachedResult(c, deps))

  return app
}

/**
 * Queues a run of a skill.
 *
 * The order of the checks is the order of the cost: the cheap ones come first, and the ones that
 * cost something, the fetch of the skill and a slot of the quota, come last.
 */
async function createRun(c: Context, deps: SandboxRouteDeps): Promise<Response> {
  const body = await readJson(c)
  if (!body.ok) return c.json(fail('BAD_REQUEST', 'The request body is not valid JSON.'), 400)
  const parsed = SandboxRunCreateRequest.safeParse(body.value)
  if (!parsed.success) {
    return c.json(fail('BAD_REQUEST', 'The request body does not match the schema.'), 400)
  }

  const answer = await prepare(deps, parsed.data)
  if ('code' in answer) return c.json(fail(answer.code, answer.message), answer.status)
  return c.json(ok(answer.data))
}

/** Does everything a request for a run needs, and answers with the run or with a refusal. */
async function prepare(
  deps: SandboxRouteDeps,
  request: z.infer<typeof SandboxRunCreateRequest>,
): Promise<{ data: CreatedRun } | Refusal> {
  if (await isPaused(deps)) {
    return { code: 'SANDBOX_PAUSED', message: 'The sandbox is paused for today.', status: 429 }
  }
  const refusal = await checkSignature(deps, request)
  if (refusal !== null) return refusal

  const reservation = await reserveNonce(
    deps.sql,
    { address: request.address, nonce: request.nonce, expiry: request.expiry },
    deps.now(),
  )
  if (!reservation.reserved) return nonceRefusal(reservation.reason)

  const cached = await cacheGet(deps, request.bundleHash, deps.probeSetVersion, deps.modelId)
  if (cached !== null) {
    const queued = await queueCached(deps, request, cached)
    if ('code' in queued) {
      await releaseNonce(deps.sql, { address: request.address, nonce: request.nonce })
      return queued
    }
    await commitNonce(deps.sql, { address: request.address, nonce: request.nonce })
    return queued
  }

  const skill = await readSkill(deps, request.src, request.bundleHash)
  if ('code' in skill) {
    await releaseNonce(deps.sql, { address: request.address, nonce: request.nonce })
    return skill
  }

  const queued = await queueRun(deps, request, skill.skillMd)
  if ('code' in queued) {
    await releaseNonce(deps.sql, { address: request.address, nonce: request.nonce })
    return queued
  }
  await commitNonce(deps.sql, { address: request.address, nonce: request.nonce })
  return queued
}

/**
 * Checks the signature and the Agent ID.
 *
 * The signature is recovered with the chain id of the service, so a signature made for another
 * chain never recovers here. The address that signed has to be the address of the request and has
 * to hold an Agent ID.
 */
async function checkSignature(
  deps: SandboxRouteDeps,
  request: z.infer<typeof SandboxRunCreateRequest>,
): Promise<Refusal | null> {
  const signer = await deps.chain.recoverSigner({
    bundleHash: request.bundleHash,
    nonce: request.nonce,
    expiry: request.expiry,
    signature: request.signature,
  })
  if (signer === null || !sameAddress(signer, request.address)) {
    return { code: 'SIGNATURE_INVALID', message: 'The signature does not match the address.', status: 400 }
  }
  const holder = await deps.chain.isAgentIdHolder(request.address)
  if (!holder) {
    return { code: 'NOT_AGENT_ID_HOLDER', message: 'This address does not hold an Agent ID.', status: 403 }
  }
  return null
}

/** The answer to a nonce that could not be reserved. */
function nonceRefusal(reason: NonceRefusal): Refusal {
  if (reason === 'expired') return { code: 'SIGNATURE_EXPIRED', message: 'The request has expired.', status: 400 }
  if (reason === 'too_far_ahead') {
    return { code: 'BAD_REQUEST', message: 'The request expires too far in the future.', status: 400 }
  }
  return { code: 'SIGNATURE_INVALID', message: 'The request was already used.', status: 400 }
}

/**
 * Reads the SKILL.md of the skill.
 *
 * The file is read from the commit the source names and is compared with the hash the client
 * signed, so the worker is never given a file that belongs to another bundle.
 */
async function readSkill(
  deps: SandboxRouteDeps,
  src: string,
  bundleHash: string,
): Promise<{ skillMd: string } | Refusal> {
  let reference
  try {
    reference = readReference(src)
  } catch {
    return { code: 'BAD_REQUEST', message: 'The sandbox only runs on a skill.', status: 400 }
  }
  try {
    return { skillMd: await readSkillMd(deps.skills, reference, bundleHash) }
  } catch (error) {
    if (error instanceof NotASkill) {
      return { code: 'BAD_REQUEST', message: 'The sandbox only runs on a skill.', status: 400 }
    }
    if (error instanceof BundleMismatch) {
      return {
        code: 'BAD_REQUEST',
        message: 'The skill at the pinned commit is not the bundle that was signed.',
        status: 400,
      }
    }
    if (error instanceof SkillUnavailable) {
      return { code: 'INTERNAL', message: 'The skill could not be read.', status: 502 }
    }
    if (error instanceof SkillTooLarge) {
      return { code: 'BAD_REQUEST', message: error.message, status: 400 }
    }
    throw error
  }
}

/**
 * Puts a run in the queue.
 *
 * The slot of the quota and the row of the run are written in one transaction, so a run is never
 * in the queue without a slot and a slot is never taken without a run.
 */
async function queueRun(
  deps: SandboxRouteDeps,
  request: z.infer<typeof SandboxRunCreateRequest>,
  skillMd: string,
): Promise<{ data: CreatedRun } | Refusal> {
  const queue: SandboxDeps = {
    sql: deps.sql,
    now: deps.now,
    probeSetVersion: deps.probeSetVersion,
    modelId: deps.modelId,
  }
  try {
    return await deps.sql.transaction(async (tx) => {
      const scoped: SandboxDeps = { ...queue, sql: tx }
      const quota = await takeQuota(scoped, request.address)
      if (!quota.taken) {
        return { code: 'QUOTA_EXHAUSTED', message: 'The daily sandbox runs are used up.', status: 429 }
      }
      const runId = newRunId()
      const position = await enqueue(scoped, {
        runId,
        address: request.address,
        bundleHash: request.bundleHash,
        src: request.src,
        skillMd,
      })
      return { data: { runId, status: 'queued', queuePosition: position, quotaLeft: quota.left } }
    })
  } catch {
    return { code: 'INTERNAL', message: 'The run could not be queued.', status: 500 }
  }
}

/**
 * Puts a run of a bundle that is already in the cache in the queue.
 *
 * The run carries the cached result, so the worker is never asked and no slot of the quota is
 * taken. The queue finishes it with that result.
 */
async function queueCached(
  deps: SandboxRouteDeps,
  request: z.infer<typeof SandboxRunCreateRequest>,
  cached: SandboxResult,
): Promise<{ data: CreatedRun } | Refusal> {
  const queue: SandboxDeps = {
    sql: deps.sql,
    now: deps.now,
    probeSetVersion: deps.probeSetVersion,
    modelId: deps.modelId,
  }
  try {
    const runId = newRunId()
    const position = await enqueue(queue, {
      runId,
      address: request.address,
      bundleHash: request.bundleHash,
      src: request.src,
      skillMd: '',
      cached,
    })
    const left = await quotaLeft({ sql: deps.sql, now: deps.now }, request.address)
    return { data: { runId, status: 'queued', queuePosition: position, quotaLeft: left } }
  } catch {
    return { code: 'INTERNAL', message: 'The run could not be queued.', status: 500 }
  }
}

/** The state of a run. */
async function runStatus(c: Context, deps: SandboxRouteDeps): Promise<Response> {
  const runId = c.req.param('runId') ?? ''
  if (!/^run_[0-9a-f]{24}$/.test(runId)) {
    return c.json(fail('BAD_REQUEST', 'The run id is not a run id.'), 400)
  }
  const state = await readRun(
    { sql: deps.sql, now: deps.now, probeSetVersion: deps.probeSetVersion, modelId: deps.modelId },
    runId,
  )
  if (state === null) return c.json(fail('RUN_NOT_FOUND', 'There is no such run.'), 404)
  return c.json(ok(state))
}

/** The runs an address has left today. */
async function quotaStatus(c: Context, deps: SandboxRouteDeps): Promise<Response> {
  const parsed = AddressSchema.safeParse(c.req.param('address'))
  if (!parsed.success) return c.json(fail('BAD_REQUEST', 'The address is not an address.'), 400)

  const left = await quotaLeft({ sql: deps.sql, now: deps.now }, parsed.data)
  return c.json(ok({ left, limit: CONSTANTS.SANDBOX_DAILY_RUNS, resetsAt: resetsAt(deps.now()) }))
}

/** The result the cache holds for a bundle. */
async function cachedResult(c: Context, deps: SandboxRouteDeps): Promise<Response> {
  const parsed = Bytes32Schema.safeParse(c.req.param('bundleHash'))
  if (!parsed.success) return c.json(fail('BAD_REQUEST', 'The bundle hash is not a 32 byte hex value.'), 400)

  const result = await cacheGet(deps, parsed.data, deps.probeSetVersion, deps.modelId)
  if (result === null) return c.json(fail('RESULT_NOT_CACHED', 'This result is no longer cached.'), 404)
  return c.json(ok({ result }))
}
