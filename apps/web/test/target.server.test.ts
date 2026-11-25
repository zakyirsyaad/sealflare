import { expect, test, vi, beforeEach } from 'vitest'
import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { TargetDetail } from '@sealflare/shared/schemas'
import { attestationRows, buildDetail, loadTarget, signalOf } from '../server/target'
import type { ChainReader, CoreAttestation, CoreTarget } from '../server/chain'

const { reader } = vi.hoisted(() => ({ reader: { current: null as unknown } }))

vi.mock('../server/chain', () => ({ getChainReader: () => reader.current }))

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
    head: async () => 52_000_012n,
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
})

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
    head: async () => {
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
