// APIs checked 2026-11-25: https://nodejs.org/docs/latest-v24.x/api/fs.html
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { PROBE_IDS, ProbeResult, WorkerRunStatus } from '@sealflare/shared/schemas'

export type LoadIssue = { file: string; message: string }
export type RunStore = {
  save(status: WorkerRunStatus): void
  get(runId: string): WorkerRunStatus | undefined
  loadAll(): LoadIssue[]
}
export const RunId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid run ID.')
const MAX_STATUS_BYTES = 16_777_216

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

function readStatus(path: string, runId: string): WorkerRunStatus | undefined {
  if (!regularFile(path)) return undefined
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_STATUS_BYTES) throw Error('Invalid status file size.')
    const status = parseStatus(JSON.parse(fs.readFileSync(fd, 'utf8')))
    if (status.runId !== runId) throw Error('Status does not match its filename.')
    return status
  } finally { fs.closeSync(fd) }
}

function replaceFile(dir: string, path: string, text: string): void {
  const temporary = join(dir, `.run-${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true })
    fs.renameSync(temporary, path)
    const fd = fs.openSync(dir, fs.constants.O_RDONLY)
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  } finally { fs.rmSync(temporary, { force: true }) }
}

export function createStore(directory: string): RunStore {
  const dir = resolve(directory), records = new Map<string, WorkerRunStatus>()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return {
    save: (input) => {
      const status = parseStatus(input), path = join(dir, `${status.runId}.json`)
      const previous = records.get(status.runId) ?? readStatus(path, status.runId)
      regularFile(path)
      assertEvidence(previous, status)
      const text = JSON.stringify(status)
      if (Buffer.byteLength(text) > MAX_STATUS_BYTES) throw Error('Status exceeds the storage limit.')
      replaceFile(dir, path, text)
      records.set(status.runId, structuredClone(status))
    },
    get: (input) => {
      const runId = RunId.parse(input), status = records.get(runId)
      return status ? structuredClone(status) : undefined
    },
    loadAll: () => {
      const issues: LoadIssue[] = []
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.endsWith('.json')) continue
        try {
          const runId = RunId.parse(file.slice(0, -5)), status = readStatus(join(dir, file), runId)
          if (!status) throw Error('Missing status file.')
          assertEvidence(records.get(runId), status)
          records.set(runId, status)
        } catch { issues.push({ file, message: 'Run status could not be loaded.' }) }
      }
      return issues
    },
  }
}
