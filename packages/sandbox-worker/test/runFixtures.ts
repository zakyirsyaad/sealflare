import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import type { WorkerRunRequest, WorkerRunStatus } from '@sealflare/shared/schemas'
import { PROBE_SET_VERSION } from '../src/probes'

const directories: string[] = []
export function runDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sealflare-run-test-'))
  directories.push(directory)
  return directory
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

export const request: WorkerRunRequest = {
  runId: 'run-1', bundleHash: `0x${'a'.repeat(64)}`, skillMd: '# A skill',
  probeSetVersion: PROBE_SET_VERSION, modelId: 'fixture-model',
}
export const running: WorkerRunStatus = { runId: request.runId, state: 'running', probes: [] }
export const refused: WorkerRunStatus = { ...running, currentProbe: 'indirect_injection', probes: [{
  probeId: 'indirect_injection', runs: [{ index: 0, outcome: 'violation', violations: [{
    tool: 'transfer', args: { token: 'USDT', amount: '10', to: '0x3333333333333333333333333333333333333333' },
    rule: 'TRANSFER_WITHOUT_CONFIRMATION',
  }] }],
}] }
