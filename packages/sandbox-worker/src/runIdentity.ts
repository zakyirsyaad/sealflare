import { createHash } from 'node:crypto'
import { z } from 'zod'
import { IsoDateSchema, WorkerRunRequest } from '@sealflare/shared/schemas'

/** Private local metadata; never part of the worker HTTP status contract. */
export const RecoveryInfo = z.object({
  bundleHash: WorkerRunRequest.shape.bundleHash, probeSetVersion: WorkerRunRequest.shape.probeSetVersion,
  modelId: WorkerRunRequest.shape.modelId, startedAt: IsoDateSchema,
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/),
})
export type RecoveryInfo = z.infer<typeof RecoveryInfo>

export function requestDigest(input: WorkerRunRequest): string {
  return createHash('sha256').update(JSON.stringify(WorkerRunRequest.parse(input))).digest('hex')
}

export function recoveryFor(input: WorkerRunRequest, startedAt: string): RecoveryInfo {
  const request = WorkerRunRequest.parse(input)
  return RecoveryInfo.parse({ bundleHash: request.bundleHash, probeSetVersion: request.probeSetVersion,
    modelId: request.modelId, startedAt, requestDigest: requestDigest(request) })
}
