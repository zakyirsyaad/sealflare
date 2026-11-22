import { z } from 'zod'
import { CONSTANTS } from '../rules'
import { EvidenceReport } from './evidence'
import { AddressSchema, Bytes32Schema, IsoDateSchema, SignatureSchema, UintStringSchema } from './primitives'
import { ProbeId, SandboxResult } from './sandbox'
import { ScanReport } from './scan'
import { SCAN_ERROR_CODES } from './scanner'

/** Errors any endpoint can return, next to its own. */
export const COMMON_ERROR_CODES = ['BAD_REQUEST', 'RATE_LIMITED', 'INTERNAL'] as const
export const SIGNED_REQUEST_ERROR_CODES = ['SIGNATURE_INVALID', 'SIGNATURE_EXPIRED', 'NOT_AGENT_ID_HOLDER'] as const
export const SANDBOX_ERROR_CODES = [...SIGNED_REQUEST_ERROR_CODES, 'QUOTA_EXHAUSTED', 'SANDBOX_PAUSED', 'RUN_NOT_FOUND'] as const
export const EVIDENCE_ERROR_CODES = [...SIGNED_REQUEST_ERROR_CODES, 'EVIDENCE_TOO_LARGE', 'UPLOAD_FAILED'] as const

export const ResponseMeta = z.object({
  /** Last final block the indexer has read. Present on every answer built from indexed data. */
  finalizedBlock: UintStringSchema.optional(),
  page: z.object({ total: z.number().int().min(0), page: z.number().int().min(1), limit: z.number().int().min(1) }).optional(),
})

/** Every API answer: either `data` or `error`, never both. */
export function envelope<T extends z.ZodType, const C extends readonly [string, ...string[]]>(data: T, errorCodes: C) {
  const codes = z.enum([...COMMON_ERROR_CODES, ...errorCodes] as [string, ...string[]])
  return z.discriminatedUnion('success', [
    z.strictObject({ success: z.literal(true), data, meta: ResponseMeta.optional() }),
    z.strictObject({
      success: z.literal(false),
      error: z.object({ code: codes, message: z.string().min(1), details: z.unknown().optional() }),
    }),
  ])
}

// POST /api/scan/contract, POST /api/scan/skill
export const ScanContractRequest = z.object({ address: AddressSchema })
export const ScanContractResponse = envelope(ScanReport, SCAN_ERROR_CODES)
export const ScanSkillRequest = z.object({ url: z.string().min(1).max(500), path: z.string().max(400).optional() })
export const ScanSkillResponse = envelope(ScanReport, SCAN_ERROR_CODES)

/** Fields every request signed by an Agent ID holder carries. `nonce` and `expiry` are part of the signed message. */
const signed = { address: AddressSchema, nonce: UintStringSchema, expiry: UintStringSchema, signature: SignatureSchema }

// POST /api/sandbox/runs
export const SandboxRunCreateRequest = z.object({ bundleHash: Bytes32Schema, src: z.string().min(1).max(600), ...signed })
export const SandboxRunCreateResponse = envelope(
  z.object({
    runId: z.string().min(1),
    status: z.literal('queued'),
    queuePosition: z.number().int().min(0),
    quotaLeft: z.number().int().min(0).max(CONSTANTS.SANDBOX_DAILY_RUNS),
  }),
  SANDBOX_ERROR_CODES,
)

// GET /api/sandbox/runs/:id
export const SandboxRunStatusResponse = envelope(
  z.object({
    runId: z.string().min(1),
    status: z.enum(['queued', 'running', 'done', 'incomplete']),
    queuePosition: z.number().int().min(0).optional(),
    currentProbe: ProbeId.optional(),
    result: SandboxResult.optional(),
    evidenceURI: z.string().optional(),
  }),
  SANDBOX_ERROR_CODES,
)

// GET /api/sandbox/quota/:address
export const SandboxQuotaResponse = envelope(
  z.object({ left: z.number().int().min(0).max(CONSTANTS.SANDBOX_DAILY_RUNS), limit: z.literal(CONSTANTS.SANDBOX_DAILY_RUNS), resetsAt: IsoDateSchema }),
  SANDBOX_ERROR_CODES,
)

// POST /api/evidence
export const EvidenceRequest = z.object({ report: EvidenceReport, ...signed })
export const EvidenceResponse = envelope(z.object({ evidenceURI: z.string().min(1), evidenceHash: Bytes32Schema }), EVIDENCE_ERROR_CODES)

/** Typed data for requests an Agent ID holder signs without sending a transaction. */
export const API_EIP712 = {
  /** Add the active `chainId` when building the domain. There is no verifying contract. */
  domain: { name: 'Sealflare API', version: '1' },
  types: {
    SandboxRun: [
      { name: 'bundleHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    EvidenceUpload: [
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  },
} as const
