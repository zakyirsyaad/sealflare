import { SandboxResult, WorkerRunStatus, deriveSandboxStatus } from '@sealflare/shared/schemas'
import type { RecoveryInfo } from './runIdentity'
import type { RunStore } from './store'

export function interrupted(status: WorkerRunStatus, identity: RecoveryInfo): WorkerRunStatus {
  const probes = structuredClone(status.probes)
  if (deriveSandboxStatus(probes) === 'NO_VIOLATION_OBSERVED') {
    // All probe progress exists, but the final completion was never durably committed.
    probes.at(-1)!.runs.at(-1)!.outcome = 'error'
  }
  const finishedAt = new Date(Math.max(Date.now(), Date.parse(identity.startedAt))).toISOString()
  const message = 'Sandbox execution was interrupted by an infrastructure failure.'
  const result = SandboxResult.parse({ schemaVersion: 1, bundleHash: identity.bundleHash,
    modelId: identity.modelId, probeSetVersion: identity.probeSetVersion, startedAt: identity.startedAt,
    finishedAt, probes, status: deriveSandboxStatus(probes), incompleteReason: message })
  return WorkerRunStatus.parse({ runId: status.runId, state: 'done', probes, result,
    failure: { cause: 'infrastructure', message } })
}

export function recoverStore(store: RunStore): void {
  for (const issue of store.loadAll()) console.warn('Skipped invalid run status file:', issue.file)
  for (const status of store.list()) {
    if (status.state !== 'running') continue
    const identity = store.recovery(status.runId)
    if (!identity) { console.warn('Skipped interrupted run without recovery metadata:', status.runId); continue }
    store.save(interrupted(status, identity))
  }
}
