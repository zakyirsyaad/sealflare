import { describe, expect, test } from 'vitest'
import type { ZodType } from 'zod'
import {
  API_EIP712,
  EvidenceRequest,
  EvidenceResponse,
  SCAN_ERROR_CODES,
  SandboxQuotaResponse,
  SandboxRunCreateRequest,
  SandboxRunCreateResponse,
  SandboxRunStatusResponse,
  ScanContractRequest,
  ScanContractResponse,
  ScanError,
  ScanSkillRequest,
  ScanSkillResponse,
  WorkerRunRequest,
  WorkerRunResponse,
  WorkerRunStatus,
} from '../schemas'
import { loadJson } from './helpers'

const loadApi = (name: string) => loadJson<Record<string, unknown>>(`api/${name}.json`)
const BUNDLE = `0x${'ab'.repeat(32)}`
const ADDRESS = '0x5555555555555555555555555555555555555555'
const SIGNATURE = `0x${'11'.repeat(65)}`

const validSandboxRequest = {
  bundleHash: BUNDLE,
  src: `gh:acme/skills@${'a'.repeat(40)}:swap-helper`,
  address: ADDRESS,
  nonce: '1',
  expiry: '1795400000',
  signature: SIGNATURE,
}
const validRunRequest = { runId: 'run_01', bundleHash: BUNDLE, skillMd: '# skill', probeSetVersion: '2026-11-1', modelId: 'claude-haiku-5-5' }

test.each<[string, ZodType]>([
  ['scan-contract.ok', ScanContractResponse],
  ['scan-skill.ok', ScanSkillResponse],
  ['scan.error', ScanSkillResponse],
  ['sandbox-run.queued', SandboxRunCreateResponse],
  ['sandbox-run.done', SandboxRunStatusResponse],
  ['sandbox-quota', SandboxQuotaResponse],
  ['evidence.ok', EvidenceResponse],
])('%s matches its schema', (name, schema) => {
  expect(schema.safeParse(loadApi(name)).error?.issues).toBeUndefined()
})

describe('envelope', () => {
  const scan = loadJson('scans/contract-clean.json')
  test('an error envelope carries no data', () => {
    expect(ScanContractResponse.safeParse({ success: false, data: scan, error: { code: 'RPC_UNAVAILABLE', message: 'x' } }).success).toBe(false)
  })
  test('a success envelope carries no error', () => {
    expect(ScanContractResponse.safeParse({ success: true, data: scan, error: { code: 'RPC_UNAVAILABLE', message: 'x' } }).success).toBe(false)
  })
  test('an error code outside the endpoint list is rejected', () => {
    expect(ScanContractResponse.safeParse({ success: false, error: { code: 'OOPS', message: 'x' } }).success).toBe(false)
    expect(SandboxRunCreateResponse.safeParse({ success: false, error: { code: 'QUOTA_EXHAUSTED', message: 'x' } }).success).toBe(true)
    expect(SandboxRunCreateResponse.safeParse({ success: false, error: { code: 'NO_SKILL_FOUND', message: 'x' } }).success).toBe(false)
  })
  test('a success envelope whose data breaks the scan rules is rejected', () => {
    expect(ScanContractResponse.safeParse({ success: true, data: { ...(scan as object), checks: [] } }).success).toBe(false)
  })
})

describe('requests', () => {
  test('scan requests accept an address and a repository link', () => {
    expect(ScanContractRequest.safeParse({ address: ADDRESS }).success).toBe(true)
    expect(ScanContractRequest.safeParse({ address: '0x12' }).success).toBe(false)
    expect(ScanSkillRequest.safeParse({ url: 'https://github.com/acme/skills' }).success).toBe(true)
    expect(ScanSkillRequest.safeParse({ url: 'x'.repeat(501) }).success).toBe(false)
  })
  test('a valid sandbox request parses', () => {
    expect(SandboxRunCreateRequest.safeParse(validSandboxRequest).error?.issues).toBeUndefined()
  })
  test('a sandbox request with a malformed signature, address, hash or nonce is rejected', () => {
    for (const patch of [{ signature: '0x12' }, { address: 'not-an-address' }, { bundleHash: '0x12' }, { nonce: '-1' }, { expiry: 'soon' }]) {
      expect(SandboxRunCreateRequest.safeParse({ ...validSandboxRequest, ...patch }).success).toBe(false)
    }
  })
  test('an evidence request needs a report that passes the evidence schema', () => {
    const report = loadJson('evidence/attestation.json')
    const base = { address: ADDRESS, nonce: '1', expiry: '1795400000', signature: SIGNATURE }
    expect(EvidenceRequest.safeParse({ ...base, report }).error?.issues).toBeUndefined()
    expect(EvidenceRequest.safeParse({ ...base, report: { ...(report as object), kind: 'opinion' } }).success).toBe(false)
  })
})

describe('worker contract', () => {
  const done = loadJson<Record<string, unknown>>('sandbox/fuzz-failed.json')
  test('a valid run request parses', () => {
    expect(WorkerRunRequest.safeParse(validRunRequest).error?.issues).toBeUndefined()
  })
  test('a run request with SKILL.md above 65,536 bytes is rejected, counting bytes not characters', () => {
    expect(WorkerRunRequest.safeParse({ ...validRunRequest, skillMd: 'x'.repeat(65_536) }).success).toBe(true)
    expect(WorkerRunRequest.safeParse({ ...validRunRequest, skillMd: 'x'.repeat(65_537) }).success).toBe(false)
    expect(WorkerRunRequest.safeParse({ ...validRunRequest, skillMd: '漢'.repeat(30_000) }).success).toBe(false)
  })
  test('a run request with an empty SKILL.md is rejected', () => {
    expect(WorkerRunRequest.safeParse({ ...validRunRequest, skillMd: '' }).success).toBe(false)
  })
  test('the worker accepts or refuses with a reason', () => {
    expect(WorkerRunResponse.safeParse({ accepted: true }).success).toBe(true)
    expect(WorkerRunResponse.safeParse({ accepted: false, reason: 'DAILY_LIMIT' }).success).toBe(true)
    expect(WorkerRunResponse.safeParse({ accepted: false }).success).toBe(false)
  })
  test('a done status must carry a result', () => {
    expect(WorkerRunStatus.safeParse({ runId: 'r1', state: 'done', probes: [] }).success).toBe(false)
    expect(WorkerRunStatus.safeParse({ runId: 'r1', state: 'done', probes: done.probes, result: done }).success).toBe(true)
  })
  test('a running status shows violations before the run ends', () => {
    const status = { runId: 'r1', state: 'running', currentProbe: 'meta_scanner_override', probes: done.probes }
    expect(WorkerRunStatus.safeParse(status).error?.issues).toBeUndefined()
  })
  test('a failure names whether infrastructure or the skill caused it', () => {
    const incomplete = loadJson<Record<string, unknown>>('sandbox/incomplete.json')
    expect(WorkerRunStatus.safeParse({ runId: 'r1', state: 'done', probes: incomplete.probes, result: incomplete, failure: { cause: 'infrastructure', message: 'x' } }).success).toBe(true)
    expect(WorkerRunStatus.safeParse({ runId: 'r1', state: 'done', probes: incomplete.probes, result: incomplete, failure: { cause: 'gremlins', message: 'x' } }).success).toBe(false)
  })
})

test('ScanError carries one of the frozen codes', () => {
  const error = new ScanError('MULTIPLE_SKILL_FOLDERS', 'More than one skill.', { folders: ['a', 'b'] })
  expect(error).toBeInstanceOf(Error)
  expect(SCAN_ERROR_CODES).toContain(error.code)
  expect(error.details?.folders).toEqual(['a', 'b'])
})

test('off-chain signatures use the frozen EIP-712 types', () => {
  expect(API_EIP712.domain).toEqual({ name: 'Sealflare API', version: '1' })
  expect(API_EIP712.types.SandboxRun.map((f) => `${f.type} ${f.name}`)).toEqual(['bytes32 bundleHash', 'uint256 nonce', 'uint256 expiry'])
  expect(API_EIP712.types.EvidenceUpload.map((f) => `${f.type} ${f.name}`)).toEqual(['bytes32 evidenceHash', 'uint256 nonce', 'uint256 expiry'])
})
