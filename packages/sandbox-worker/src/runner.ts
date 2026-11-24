import { z } from 'zod'
import { CONSTANTS } from '@sealflare/shared/rules'
import { PROBE_IDS, SandboxResult, WorkerRunRequest, WorkerRunStatus, deriveSandboxStatus } from '@sealflare/shared/schemas'
import { PROBES, PROBE_SET_VERSION } from './probes'
import type { LlmClient } from './llm'
import type { Budget } from './budget'
import { RunId, type RunStore } from './store'
import { executeRun } from './runStep'

type Dependencies = { llm: LlmClient; store: RunStore; budget: Budget; now?: () => Date; maxSteps?: number }

function finish(request: WorkerRunRequest, status: WorkerRunStatus, startedAt: string, finishedAt: string,
  cause: 'infrastructure' | 'skill_content' | undefined,
): WorkerRunStatus {
  const result = SandboxResult.parse({ schemaVersion: 1, bundleHash: request.bundleHash,
    probeSetVersion: request.probeSetVersion, modelId: request.modelId, startedAt, finishedAt,
    status: deriveSandboxStatus(status.probes), probes: status.probes,
    ...(cause ? { incompleteReason: cause === 'infrastructure' ? 'Sandbox infrastructure is unavailable.' : 'A probe run did not complete.' } : {}),
  })
  return WorkerRunStatus.parse({ runId: status.runId, state: 'done', probes: status.probes, result,
    ...(cause ? { failure: { cause, message: result.incompleteReason! } } : {}),
  })
}

export async function runProbeSet(input: WorkerRunRequest, deps: Dependencies): Promise<WorkerRunStatus> {
  const request = WorkerRunRequest.parse(input), maxSteps = z.number().int().min(1).max(1000).parse(deps.maxSteps ?? 8)
  RunId.parse(request.runId)
  if (request.probeSetVersion !== PROBE_SET_VERSION) throw Error('Unsupported probe set version.')
  if (deps.store.get(request.runId)) throw Error('Run ID already exists.')
  const now = deps.now ?? (() => new Date()), startedAt = now().toISOString()
  const status: WorkerRunStatus = { runId: request.runId, state: 'running', probes: [] }
  let cause: 'infrastructure' | 'skill_content' | undefined
  deps.store.save(status)
  outer: for (const probeId of PROBE_IDS) {
    const probe = PROBES[probeId], result = { probeId, runs: [] as WorkerRunStatus['probes'][number]['runs'] }
    status.currentProbe = probeId; status.probes.push(result)
    deps.store.save(status)
    for (let index = 0; index < CONSTANTS.PROBE_RUNS; index++) {
      const completed = await executeRun(index as 0 | 1 | 2, { llm: deps.llm, budget: deps.budget,
        model: request.modelId, system: probe.systemPrompt(request.skillMd), probe, maxSteps })
      result.runs.push(completed.run)
      deps.store.save(status)
      if (completed.infrastructure) { cause = 'infrastructure'; break outer }
      if (completed.run.outcome === 'error') cause = 'skill_content'
    }
  }
  const final = finish(request, status, startedAt, now().toISOString(), cause)
  deps.store.save(final)
  return final
}
