// APIs checked 2026-11-25: https://nodejs.org/docs/latest-v24.x/api/fs.html
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { PROBE_IDS, ProbeResult, WorkerRunStatus } from '@sealflare/shared/schemas'
import { RecoveryInfo } from './runIdentity'
import { replaceFile } from './atomicFile'

export type LoadIssue = { file: string; message: string }
export type RunStore = {
  save(status: WorkerRunStatus, recovery?: RecoveryInfo): void
  get(runId: string): WorkerRunStatus | undefined
  recovery(runId: string): RecoveryInfo | undefined
  list(): WorkerRunStatus[]
  loadAll(): LoadIssue[]
}
export const RunId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid run ID.')
const MAX_STATUS_BYTES = 16_777_216

function assertIdentity(status: WorkerRunStatus, identity: RecoveryInfo | undefined): void {
  if (!identity || !status.result) return
  const result = status.result
  if (result.bundleHash !== identity.bundleHash || result.modelId !== identity.modelId
    || result.probeSetVersion !== identity.probeSetVersion || result.startedAt !== identity.startedAt) {
    throw Error('Result does not match the run identity.')
  }
}

function parseStatus(input: unknown): WorkerRunStatus {
  const status = WorkerRunStatus.parse(input)
  RunId.parse(status.runId)
  z.array(ProbeResult).max(PROBE_IDS.length).parse(status.probes)
  if (new Set(status.probes.map(({ probeId }) => probeId)).size !== status.probes.length) throw Error('Duplicate probe.')
  for (const probe of status.probes) for (const run of probe.runs) for (const violation of run.violations) {
    z.json().parse(violation.args)
  }
  if (status.result && JSON.stringify(status.result.probes) !== JSON.stringify(status.probes)) throw Error('Mismatched result probes.')
  return status
}

function assertEvidence(previous: WorkerRunStatus | undefined, next: WorkerRunStatus): void {
  for (const probe of previous?.probes ?? []) for (const run of probe.runs) {
    if (run.outcome !== 'violation') continue
    const candidate = next.probes.find(({ probeId }) => probeId === probe.probeId)?.runs.find(({ index }) => index === run.index)
    if (candidate?.outcome !== 'violation' || run.violations.some((violation) =>
      !candidate.violations.some((value) => JSON.stringify(value) === JSON.stringify(violation)))) {
      throw Error('Captured violations cannot be removed or rewritten.')
    }
  }
}

function regularFile(path: string): boolean {
  try {
    if (!fs.lstatSync(path).isFile()) throw Error('Status path is not a regular file.')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function readRecord(path: string, runId: string): { status: WorkerRunStatus; recovery?: RecoveryInfo } | undefined {
  if (!regularFile(path)) return undefined
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_STATUS_BYTES) throw Error('Invalid status file size.')
    const decoded: unknown = JSON.parse(fs.readFileSync(fd, 'utf8')), status = parseStatus(decoded)
    const recovery = z.object({ _recovery: RecoveryInfo.optional() }).parse(decoded)._recovery
    assertIdentity(status, recovery)
    if (status.runId !== runId) throw Error('Status does not match its filename.')
    return { status, recovery }
  } finally { fs.closeSync(fd) }
}

export function createStore(directory: string): RunStore {
  const dir = resolve(directory), records = new Map<string, WorkerRunStatus>(), identities = new Map<string, RecoveryInfo>()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return {
    save: (input, recovery) => {
      const status = parseStatus(input), path = join(dir, `${status.runId}.json`)
      const disk = records.has(status.runId) ? undefined : readRecord(path, status.runId)
      const previous = records.get(status.runId) ?? disk?.status
      const existing = identities.get(status.runId) ?? disk?.recovery
      const metadata = recovery === undefined ? existing : RecoveryInfo.parse(recovery)
      if (existing && JSON.stringify(metadata) !== JSON.stringify(existing)) throw Error('Run identity cannot be changed.')
      assertIdentity(status, metadata)
      regularFile(path)
      assertEvidence(previous, status)
      const text = JSON.stringify({ ...status, ...(metadata ? { _recovery: metadata } : {}) })
      if (Buffer.byteLength(text) > MAX_STATUS_BYTES) throw Error('Status exceeds the storage limit.')
      const snapshot = structuredClone(status)
      replaceFile(path, text, () => {
        records.set(status.runId, snapshot)
        if (metadata) identities.set(status.runId, structuredClone(metadata))
      })
    },
    get: (input) => {
      const runId = RunId.parse(input), status = records.get(runId)
      return status ? structuredClone(status) : undefined
    },
    recovery: (input) => {
      const metadata = identities.get(RunId.parse(input))
      return metadata ? structuredClone(metadata) : undefined
    },
    list: () => structuredClone([...records.values()]),
    loadAll: () => {
      const issues: LoadIssue[] = []
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith('.json')) continue
        try {
          const runId = RunId.parse(file.slice(0, -5)), record = readRecord(join(dir, file), runId)
          if (!record) throw Error('Missing status file.')
          assertEvidence(records.get(runId), record.status)
          records.set(runId, record.status)
          if (record.recovery) identities.set(runId, record.recovery)
        } catch { issues.push({ file, message: 'Run status could not be loaded.' }) }
      }
      return issues
    },
  }
}
