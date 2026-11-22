import { z } from 'zod'
import { CONSTANTS } from '../rules'
import { Bytes32Schema, utf8Length } from './primitives'
import { ProbeId, ProbeResult, SandboxResult } from './sandbox'

/**
 * Contract between the internal service and the sandbox worker, both on the VPS.
 * The internal service calls the worker; the worker never opens a connection back, so nothing a
 * skill injects can steer it toward Postgres or the internal service.
 * Every request carries `Authorization: Bearer <inter-service key>`.
 */

// POST /runs on the worker
export const WorkerRunRequest = z.object({
  runId: z.string().min(1).max(64),
  bundleHash: Bytes32Schema,
  /** The only part of a skill the sandbox reads. Helper scripts are never sent and never run. */
  skillMd: z
    .string()
    .min(1)
    .refine((text) => utf8Length(text) <= CONSTANTS.MAX_SKILL_MD_BYTES, 'SKILL.md is larger than 65,536 bytes'),
  probeSetVersion: z.string().min(1).max(40),
  modelId: z.string().min(1).max(80),
})
export type WorkerRunRequest = z.infer<typeof WorkerRunRequest>

/** 202 when accepted; 429 with a reason when the daily cost limit is hit or a run is in progress. */
export const WorkerRunResponse = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true) }),
  z.object({ accepted: z.literal(false), reason: z.enum(['DAILY_LIMIT', 'BUSY']) }),
])
export type WorkerRunResponse = z.infer<typeof WorkerRunResponse>

// GET /runs/:id on the worker
export const WorkerRunStatus = z
  .object({
    runId: z.string().min(1),
    state: z.enum(['running', 'done']),
    currentProbe: ProbeId.optional(),
    /** Every run finished so far, so a violation is visible, and can be stored, before the run ends. */
    probes: z.array(ProbeResult),
    result: SandboxResult.optional(),
    evidenceURI: z.string().optional(),
    /** `infrastructure` returns the caller's quota; `skill_content` does not. */
    failure: z.object({ cause: z.enum(['infrastructure', 'skill_content']), message: z.string() }).optional(),
  })
  .refine((status) => status.state !== 'done' || status.result !== undefined, 'a finished run must carry its result')
export type WorkerRunStatus = z.infer<typeof WorkerRunStatus>
