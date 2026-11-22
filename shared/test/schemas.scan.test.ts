import { describe, expect, test } from 'vitest'
import { FLAGS } from '../rules'
import {
  EvidenceReport,
  PROBE_IDS,
  type ProbeResult,
  SandboxResult,
  ScanReport,
  decodeSrc,
  deriveSandboxStatus,
  encodeSrc,
  evidenceHashOf,
} from '../schemas'
import { loadJson } from './helpers'

const loadScan = (name: string) => loadJson<Record<string, unknown>>(`scans/${name}.json`)
const loadSandbox = (name: string) => loadJson<Record<string, unknown>>(`sandbox/${name}.json`)

/** Fills the 6 x 3 run grid in order: violations first, then errors, then clean runs. */
function probesWith(counts: { violation: number; error: number; clean: number }): ProbeResult[] {
  const outcomes = [
    ...Array<'violation'>(counts.violation).fill('violation'),
    ...Array<'error'>(counts.error).fill('error'),
    ...Array<'clean'>(counts.clean).fill('clean'),
  ]
  return PROBE_IDS.map((probeId, p) => ({
    probeId,
    runs: outcomes.slice(p * 3, p * 3 + 3).map((outcome, i) => ({
      index: i as 0 | 1 | 2,
      outcome,
      violations: outcome === 'violation' ? [{ tool: 'transfer', args: {}, rule: 'UNCONFIRMED_TRANSFER' }] : [],
    })),
  })).filter((probe) => probe.runs.length > 0)
}

describe('ScanReport', () => {
  test.each(['contract-clean', 'contract-proxy', 'contract-partial', 'skill-clean', 'skill-dangerous'])('%s parses', (name) => {
    expect(ScanReport.safeParse(loadScan(name)).error?.issues).toBeUndefined()
  })
  test('a report with a failed or skipped check can never suggest SAFE', () => {
    const clean = loadScan('contract-clean')
    const withStatus = (status: string) => ({
      ...clean,
      checks: (clean.checks as { id: string }[]).map((c, i) => (i === 0 ? { ...c, status } : c)),
    })
    expect(ScanReport.safeParse(withStatus('failed')).success).toBe(false)
    expect(ScanReport.safeParse(withStatus('skipped')).success).toBe(false)
    expect(ScanReport.safeParse({ ...withStatus('failed'), suggestedVerdict: 'CAUTION' }).success).toBe(true)
  })
  test('a report with any finding can never suggest SAFE', () => {
    expect(ScanReport.safeParse({ ...loadScan('skill-dangerous'), suggestedVerdict: 'SAFE' }).success).toBe(false)
  })
  test('a report with no checks at all can never suggest SAFE', () => {
    expect(ScanReport.safeParse({ ...loadScan('contract-clean'), checks: [] }).success).toBe(false)
  })
  test('flags must equal the union of finding flags', () => {
    const dangerous = loadScan('skill-dangerous')
    expect(ScanReport.safeParse({ ...dangerous, flags: 0 }).success).toBe(false)
    expect(ScanReport.safeParse({ ...dangerous, flags: (dangerous.flags as number) | FLAGS.SANDBOX_FUZZ_FAILED }).success).toBe(false)
  })
  test('a finding must use a flag of the report target type', () => {
    const proxy = loadScan('contract-proxy')
    const findings = [{ ...(proxy.findings as object[])[0], flag: 'TROJAN_HELPER_SCRIPT' }]
    expect(ScanReport.safeParse({ ...proxy, findings, flags: FLAGS.TROJAN_HELPER_SCRIPT }).success).toBe(false)
  })
  test('the source kind must match the target type', () => {
    expect(ScanReport.safeParse({ ...loadScan('contract-clean'), source: loadScan('skill-clean').source }).success).toBe(false)
  })
  test('an excerpt longer than 512 bytes is rejected', () => {
    const proxy = loadScan('contract-proxy')
    const findings = [{ ...(proxy.findings as object[])[0], excerpt: 'x'.repeat(513) }]
    expect(ScanReport.safeParse({ ...proxy, findings }).success).toBe(false)
  })
})

describe('SandboxResult', () => {
  test.each(['no-violation', 'fuzz-failed', 'incomplete'])('%s parses', (name) => {
    expect(SandboxResult.safeParse(loadSandbox(name)).error?.issues).toBeUndefined()
  })
  test('one violation makes the run SANDBOX_FUZZ_FAILED even when other runs errored', () => {
    expect(deriveSandboxStatus(probesWith({ violation: 1, error: 5, clean: 12 }))).toBe('SANDBOX_FUZZ_FAILED')
  })
  test('one violation is enough even when the run stopped right after it', () => {
    expect(deriveSandboxStatus(probesWith({ violation: 1, error: 0, clean: 0 }))).toBe('SANDBOX_FUZZ_FAILED')
  })
  test('errors without a violation make the run INCOMPLETE', () => {
    expect(deriveSandboxStatus(probesWith({ violation: 0, error: 1, clean: 17 }))).toBe('INCOMPLETE')
  })
  test('fewer than 18 runs without a violation is INCOMPLETE', () => {
    expect(deriveSandboxStatus(probesWith({ violation: 0, error: 0, clean: 17 }))).toBe('INCOMPLETE')
    expect(deriveSandboxStatus([])).toBe('INCOMPLETE')
  })
  test('only 18 clean runs are NO_VIOLATION_OBSERVED', () => {
    expect(deriveSandboxStatus(probesWith({ violation: 0, error: 0, clean: 18 }))).toBe('NO_VIOLATION_OBSERVED')
  })
  test('a stored status that disagrees with its probes is rejected', () => {
    expect(SandboxResult.safeParse({ ...loadSandbox('fuzz-failed'), status: 'NO_VIOLATION_OBSERVED' }).success).toBe(false)
    expect(SandboxResult.safeParse({ ...loadSandbox('incomplete'), status: 'NO_VIOLATION_OBSERVED' }).success).toBe(false)
  })
  test('a run marked clean cannot carry violations, and a violation needs at least one', () => {
    const result = loadSandbox('fuzz-failed') as { probes: { runs: { outcome: string; violations: unknown[] }[] }[] }
    const relabel = (outcome: string, violations?: unknown[]) => ({
      ...result,
      probes: result.probes.map((p, i) =>
        i === 4 ? { ...p, runs: p.runs.map((r, j) => (j === 0 ? { ...r, outcome, violations: violations ?? r.violations } : r)) } : p,
      ),
    })
    expect(SandboxResult.safeParse(relabel('clean')).success).toBe(false)
    expect(SandboxResult.safeParse(relabel('violation', [])).success).toBe(false)
  })
  test('the same probe cannot appear twice', () => {
    const result = loadSandbox('no-violation') as { probes: unknown[] }
    expect(SandboxResult.safeParse({ ...result, probes: [...result.probes, result.probes[0]] }).success).toBe(false)
  })
})

describe('EvidenceReport', () => {
  test('the attestation fixture parses', () => {
    expect(EvidenceReport.safeParse(loadJson('evidence/attestation.json')).error?.issues).toBeUndefined()
  })
  test('a shortProof above 512 bytes is rejected', () => {
    const report = loadJson<Record<string, unknown>>('evidence/attestation.json')
    expect(EvidenceReport.safeParse({ ...report, shortProof: '漢'.repeat(171) }).success).toBe(false)
  })
  test('a statement above 4000 characters is rejected', () => {
    const report = loadJson<Record<string, unknown>>('evidence/attestation.json')
    expect(EvidenceReport.safeParse({ ...report, statement: 'x'.repeat(4001) }).success).toBe(false)
  })
  test('evidenceHashOf is the keccak256 of the exact bytes', () => {
    expect(evidenceHashOf(new Uint8Array())).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(evidenceHashOf(new TextEncoder().encode('{"a":1}'))).not.toBe(evidenceHashOf(new TextEncoder().encode('{"a": 1}')))
  })
})

describe('src', () => {
  const commit = 'a'.repeat(40)
  test('decodes a contract address and lower-cases it', () => {
    expect(decodeSrc('0x1234567890ABCDEF1234567890abcdef12345678')).toEqual({
      kind: 'contract',
      address: '0x1234567890abcdef1234567890abcdef12345678',
    })
  })
  test('decodes a skill reference', () => {
    expect(decodeSrc(`gh:acme/skills@${commit}:swap-helper`)).toEqual({ kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'swap-helper' })
    expect(decodeSrc(`gh:acme/skills@${commit}:`)).toEqual({ kind: 'skill', owner: 'acme', repo: 'skills', commit, path: '' })
  })
  test.each([
    'https://evil.example/x',
    '0x1234',
    `gh:acme/skills@main:swap-helper`,
    `gh:acme/skills@${commit}:../etc`,
    `gh:acme/skills@${commit}:/abs`,
    `gh:acme/../x@${commit}:a`,
    `gh:acme/skills/extra@${commit}:a`,
    '',
  ])('rejects %s', (src) => {
    expect(decodeSrc(src)).toBeNull()
  })
  test('encodeSrc round-trips through decodeSrc', () => {
    const contract = ScanReport.parse(loadScan('contract-clean')).source
    const skill = ScanReport.parse(loadScan('skill-clean')).source
    expect(decodeSrc(encodeSrc(contract))).toEqual({ kind: 'contract', address: '0x60b9262456de011f7d15a54cdd8c48baaa8b022f' })
    expect(decodeSrc(encodeSrc(skill))).toEqual({ kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'swap-helper' })
  })
})
