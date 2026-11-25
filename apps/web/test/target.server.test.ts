import { expect, test, vi, beforeEach } from 'vitest'
import { FLAGS, canonicalBundleHash, targetIdOfContract, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { attestationRows, buildDetail, loadTarget, signalOf } from '../server/target'
import { clearScans } from '../server/scanStore'
import type { ChainReader, CoreAttestation, CoreTarget } from '../server/chain'

const { reader } = vi.hoisted(() => ({ reader: { current: null as unknown } }))

vi.mock('../server/chain', () => ({ getChainReader: () => reader.current }))

const { scanner } = vi.hoisted(() => ({ scanner: { scanContract: vi.fn(), scanSkill: vi.fn() } }))
vi.mock('../server/scanner', () => ({
  getScanEnvironment: () => ({ scanner, rpc: {}, explorer: {}, repo: {}, now: () => new Date('2026-11-25T03:00:00.000Z') }),
}))

const address = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const targetId = targetIdOfContract(address)

function coreTarget(overrides: Partial<CoreTarget> = {}): CoreTarget {
  return {
    targetType: 'SMART_CONTRACT',
    target: `0x${'00'.repeat(12)}${address.slice(2)}`,
    pinnedCodehash: `0x${'22'.repeat(32)}`,
    hasDelegatecall: false,
    publisher: '0x0000000000000000000000000000000000000000',
    publisherRole: 'NONE',
    safeWeight: 42,
    cautionWeight: 0,
    dangerWeight: 15,
    activeFlags: 0,
    attestationCount: 2,
    safeCount: 1,
    confirmedDanger: false,
    activeChallengeId: 0n,
    createdAt: 1_700_000_000,
    ...overrides,
  }
}

function attestation(overrides: Partial<CoreAttestation> = {}): CoreAttestation {
  return {
    guardian: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    verdict: 'SAFE',
    flags: 0,
    weight: 1,
    safeOrdinal: 1,
    timestamp: 1_700_000_100,
    settled: true,
    penalized: false,
    castDuringDispute: false,
    ...overrides,
  }
}

function fakeReader(overrides: Partial<ChainReader> = {}): ChainReader {
  return {
    target: async () => coreTarget(),
    tier: async () => 'UNRATED',
    attestations: async () => [attestation(), attestation({ verdict: 'DANGER', weight: 3, flags: FLAGS.HIDDEN_MINT, safeOrdinal: 0 })],
    evidence: async () => [
      { index: 0, shortProof: 'source verified', evidenceURI: 'https://example.org/1', txHash: `0x${'33'.repeat(32)}` },
      { index: 1, shortProof: 'owner can mint', evidenceURI: '', txHash: `0x${'44'.repeat(32)}` },
    ],
    bond: async () => ({ amount: 0n, withdrawalAvailableAt: 0 }),
    ...overrides,
  }
}

beforeEach(() => {
  reader.current = fakeReader()
  clearScans()
  scanner.scanContract.mockReset()
  scanner.scanSkill.mockReset()
})

const otherAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const codehash = `0x${'22'.repeat(32)}` as const
const SHA = 'a'.repeat(40)
const SKILL_SRC = `gh:sealflare/guard@${SHA}:skills/guard`

function contractReport(forAddress: string, blockNumber = '52000000') {
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'SMART_CONTRACT',
    targetId: targetIdOfContract(forAddress as `0x${string}`),
    source: { kind: 'contract', address: forAddress, codehash, blockNumber },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [{ id: 'source_verified', status: 'passed' }],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  })
}

function skillReport(contentHash: `0x${string}`) {
  const bundle = canonicalBundleHash(contentHash, address)
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: targetIdOfSkill(bundle),
    source: {
      kind: 'skill', repo: 'sealflare/guard', commit: SHA, path: 'skills/guard', contentHash,
      manifestPublisher: address, canonicalBundleHash: bundle, fileCount: 3, totalBytes: 2048,
    },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [{ id: 'bundle_hash', status: 'passed' }],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  })
}

function skillTarget(report: ReturnType<typeof skillReport>, overrides: Partial<CoreTarget> = {}) {
  return coreTarget({ targetType: 'AI_SKILL_BUNDLE', target: report.targetId as `0x${string}`, ...overrides })
}

test('the tier comes from Core even when the row of the target disagrees', async () => {
  reader.current = fakeReader({ tier: async () => 'UNRATED' })
  const data = await loadTarget(targetId, null)
  expect(data.detail?.tier).toBe('UNRATED')
  expect(data.detail?.signal.newIds.weight.safe).toBe(1)
  expect(data.detail?.signal.guardians.weight.danger).toBe(3)
})

test('the signal splits the new Agent IDs from the experienced Guardians', () => {
  const signal = signalOf([attestation(), attestation({ weight: 3, verdict: 'DANGER', flags: FLAGS.HIDDEN_MINT })])
  expect(signal.newIds.votes.safe).toBe(1)
  expect(signal.newIds.weight.safe).toBe(1)
  expect(signal.guardians.votes.danger).toBe(1)
  expect(signal.guardians.weight.danger).toBe(3)
  expect(signal.guardians.flags).toBe(FLAGS.HIDDEN_MINT)
})

test('the votes are joined with the evidence of the event log', () => {
  const rows = attestationRows([attestation(), attestation({ verdict: 'DANGER' })], [
    { index: 0, shortProof: 'source verified', evidenceURI: 'https://example.org/1', txHash: `0x${'33'.repeat(32)}` },
  ])
  expect(rows[0]?.evidenceURI).toBe('https://example.org/1')
  expect(rows[0]?.at).toBe('2023-11-14T22:15:00.000Z')
  expect(rows[1]?.evidenceURI).toBe('')
  expect(rows[1]?.txHash).toBe(`0x${'0'.repeat(64)}`)
})

test('the detail of a target matches the read model schema', () => {
  const detail = buildDetail({
    targetId,
    target: coreTarget(),
    tier: 'CAUTION_FLAGGED',
    attestations: [attestation()],
    scan: null,
    bond: 5_000_000_000_000_000n,
    src: null,
  })
  expect(TargetDetail.safeParse(detail).success).toBe(true)
  expect(detail.bond).toBe('5000000000000000')
  expect(detail.src).toBe(address)
})

test('a target that the registry does not know has no detail', async () => {
  reader.current = fakeReader({ target: async () => null })
  const data = await loadTarget(targetId, null)
  expect(data.detail).toBeNull()
  expect(data.failed).toBe(false)
})

test('a chain that cannot be read fails the page instead of showing a tier', async () => {
  reader.current = fakeReader({
    target: async () => {
      throw new Error('no rpc')
    },
  })
  const data = await loadTarget(targetId, null)
  expect(data.failed).toBe(true)
  expect(data.detail).toBeNull()
})

test('the page tells how many blocks behind the scan is', async () => {
  reader.current = fakeReader()
  const data = await loadTarget(targetId, null)
  expect(data.blocksBehind).toBeNull()
})

test('a source for another contract neither runs a scan nor shows its findings, and the chain tier still renders', async () => {
  reader.current = fakeReader({ tier: async () => 'CAUTION_FLAGGED' })
  scanner.scanContract.mockResolvedValue(contractReport(otherAddress))
  const data = await loadTarget(targetId, otherAddress)
  expect(scanner.scanContract).not.toHaveBeenCalled()
  expect(data.scan).toBeNull()
  expect(data.versionChanged).toBe(false)
  expect(data.detail?.tier).toBe('CAUTION_FLAGGED')
})

test('a contract source opened on an on-chain skill keeps its tier and runs no scan', async () => {
  const report = skillReport(`0x${'55'.repeat(32)}`)
  reader.current = fakeReader({ target: async () => skillTarget(report), tier: async () => 'CONFIRMED_DANGER' })
  const data = await loadTarget(report.targetId, address)
  expect(scanner.scanContract).not.toHaveBeenCalled()
  expect(data.detail?.tier).toBe('CONFIRMED_DANGER')
  expect(data.scan).toBeNull()
})

test('a skill source on an on-chain contract keeps its tier and runs no scan', async () => {
  reader.current = fakeReader({ tier: async () => 'CONFIRMED_DANGER' })
  const data = await loadTarget(targetId, SKILL_SRC)
  expect(scanner.scanSkill).not.toHaveBeenCalled()
  expect(data.detail?.tier).toBe('CONFIRMED_DANGER')
})

test('a scan of the same target is attached', async () => {
  scanner.scanContract.mockResolvedValue(contractReport(address))
  const data = await loadTarget(targetId, address)
  expect(data.scan?.targetId).toBe(targetId)
  expect(data.versionChanged).toBe(false)
})

test('a newer version of a skill is not attached, and the page offers the current version instead', async () => {
  const audited = skillReport(`0x${'55'.repeat(32)}`)
  const current = skillReport(`0x${'66'.repeat(32)}`)
  reader.current = fakeReader({
    target: async () => skillTarget(audited, { publisher: address, publisherRole: 'VERIFIED_PUBLISHER' }),
    tier: async () => 'COMMUNITY_SAFE',
  })
  scanner.scanSkill.mockResolvedValue(current)
  const data = await loadTarget(audited.targetId, SKILL_SRC)
  expect(data.scan).toBeNull()
  expect(data.versionChanged).toBe(true)
  expect(data.differentBundle).toBe(false)
  expect(data.uncheckedBundle).toBe(false)
  expect(data.currentVersionId).toBe(current.targetId)
  expect(data.detail?.tier).toBe('COMMUNITY_SAFE')
})

test('a skill link that names another publisher is a different bundle, not a new version', async () => {
  const audited = skillReport(`0x${'55'.repeat(32)}`)
  const other = skillReport(`0x${'66'.repeat(32)}`)
  reader.current = fakeReader({
    target: async () =>
      skillTarget(audited, { publisher: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', publisherRole: 'VERIFIED_PUBLISHER' }),
    tier: async () => 'COMMUNITY_SAFE',
  })
  scanner.scanSkill.mockResolvedValue(other)
  const data = await loadTarget(audited.targetId, SKILL_SRC)
  expect(data.scan).toBeNull()
  expect(data.versionChanged).toBe(false)
  expect(data.differentBundle).toBe(true)
  expect(data.uncheckedBundle).toBe(false)
  // The foreign source is not attached, so the page never offers to scan it again.
  expect(data.detail?.src).toBeNull()
})

test('a skill target without a publisher on chain never claims a link as a new version', async () => {
  const audited = skillReport(`0x${'55'.repeat(32)}`)
  reader.current = fakeReader({ target: async () => skillTarget(audited), tier: async () => 'COMMUNITY_SAFE' })
  scanner.scanSkill.mockResolvedValue(skillReport(`0x${'66'.repeat(32)}`))
  const data = await loadTarget(audited.targetId, SKILL_SRC)
  expect(data.versionChanged).toBe(false)
  expect(data.differentBundle).toBe(false)
  expect(data.uncheckedBundle).toBe(true)
  expect(data.detail?.src).toBeNull()
})

test('a sponsored skill never claims that a link names another bundle, because the sponsor is not the author', async () => {
  const audited = skillReport(`0x${'55'.repeat(32)}`)
  reader.current = fakeReader({
    target: async () =>
      skillTarget(audited, { publisher: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', publisherRole: 'THIRD_PARTY_SPONSOR' }),
    tier: async () => 'COMMUNITY_SAFE',
  })
  scanner.scanSkill.mockResolvedValue(skillReport(`0x${'66'.repeat(32)}`))
  const data = await loadTarget(audited.targetId, SKILL_SRC)
  expect(data.versionChanged).toBe(false)
  expect(data.differentBundle).toBe(false)
  expect(data.uncheckedBundle).toBe(true)
  expect(data.detail?.src).toBeNull()
})

test('the same mismatched skill source is scanned once, not on every request', async () => {
  const audited = skillReport(`0x${'55'.repeat(32)}`)
  scanner.scanSkill.mockResolvedValue(skillReport(`0x${'66'.repeat(32)}`))
  reader.current = fakeReader({ target: async () => skillTarget(audited) })
  await loadTarget(audited.targetId, SKILL_SRC)
  await loadTarget(audited.targetId, SKILL_SRC)
  expect(scanner.scanSkill).toHaveBeenCalledTimes(1)
})

test('a contract page never claims a changed version, because its id does not depend on its code', async () => {
  scanner.scanContract.mockResolvedValue(contractReport(address))
  const data = await loadTarget(targetId, address)
  expect(data.versionChanged).toBe(false)
  expect(data.currentVersionId).toBeNull()
})

test('the lag is never measured from the age of a scan, because the tier and votes were read live', async () => {
  scanner.scanContract.mockResolvedValue(contractReport(address, '100'))
  const data = await loadTarget(targetId, address)
  expect(data.scan).not.toBeNull()
  expect(data.blocksBehind).toBeNull()
})

test('a failed evidence read is reported, the votes and the tier stay, and the page does not fail', async () => {
  reader.current = fakeReader({
    evidence: async () => {
      throw new Error('getLogs range too wide')
    },
  })
  const data = await loadTarget(targetId, null)
  expect(data.failed).toBe(false)
  expect(data.evidenceFailed).toBe(true)
  expect(data.attestations).toHaveLength(2)
  expect(data.detail).not.toBeNull()
})

test('a working evidence read is not reported as failed', async () => {
  const data = await loadTarget(targetId, null)
  expect(data.evidenceFailed).toBe(false)
})

test('the evidence is read from the block the target was created in', async () => {
  const evidence = vi.fn(async () => [])
  reader.current = fakeReader({ evidence })
  await loadTarget(targetId, null)
  expect(evidence).toHaveBeenCalledWith(targetId, 1_700_000_000, 2)
})

test('a target without attestations never reads the event log', async () => {
  const evidence = vi.fn(async () => [])
  reader.current = fakeReader({ evidence, target: async () => coreTarget({ attestationCount: 0 }) })
  const data = await loadTarget(targetId, null)
  expect(evidence).not.toHaveBeenCalled()
  expect(data.evidenceFailed).toBe(false)
})
