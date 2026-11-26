import { expect, test, vi, beforeEach } from 'vitest'
import { targetIdOfContract } from '@sealflare/shared/rules'
import type { Hex } from 'viem'
import { loadTarget } from '../server/target'
import type { ChainReader, CoreAttestation, CoreTarget, EvidenceRow } from '../server/chain'
import type { IndexedEvidence } from '../server/indexedEvidence'

const { reader } = vi.hoisted(() => ({ reader: { current: null as unknown } }))
vi.mock('../server/chain', async () => {
  const actual = await vi.importActual<typeof import('../server/chain')>('../server/chain')
  return { ...actual, getChainReader: () => reader.current }
})

const { indexed } = vi.hoisted(() => ({ indexed: { read: null as null | (() => Promise<IndexedEvidence | null>) } }))
vi.mock('../server/indexedEvidence', () => ({
  readIndexedEvidence: () => (indexed.read === null ? Promise.resolve(null) : indexed.read()),
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
    safeWeight: 0,
    cautionWeight: 0,
    dangerWeight: 0,
    activeFlags: 0,
    attestationCount: 2,
    safeCount: 0,
    confirmedDanger: false,
    activeChallengeId: 0n,
    createdAt: 1_700_000_000,
    ...overrides,
  }
}

function attestation(): CoreAttestation {
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
  }
}

function evidenceRow(index: number, uri: string): EvidenceRow {
  return { index, shortProof: 'source verified', evidenceURI: uri, txHash: `0x${'33'.repeat(32)}` as Hex }
}

function fakeReader(overrides: Partial<ChainReader> = {}): ChainReader {
  return {
    target: async () => coreTarget(),
    tier: async () => 'COMMUNITY_SAFE',
    attestations: async () => [attestation(), attestation()],
    evidence: async () => [evidenceRow(0, 'ipfs://old'), evidenceRow(1, 'ipfs://old-tail')],
    evidenceFrom: async () => [evidenceRow(1, 'ipfs://tail')],
    bond: async () => ({ amount: 0n, withdrawalAvailableAt: 0 }),
    ...overrides,
  }
}

beforeEach(() => {
  indexed.read = async () => null
  reader.current = fakeReader()
})

test('the votes of the internal service are used, and the chain is only asked for the tail', async () => {
  const evidence = vi.fn(fakeReader().evidence)
  const evidenceFrom = vi.fn(fakeReader().evidenceFrom)
  indexed.read = async () => ({ rows: [evidenceRow(0, 'ipfs://indexed')], finalizedBlock: 100n })
  reader.current = fakeReader({ evidence, evidenceFrom })

  const data = await loadTarget(targetId, null)

  expect(evidence).not.toHaveBeenCalled()
  // Only the blocks above the final block of the indexer are read from the chain.
  expect(evidenceFrom).toHaveBeenCalledWith(targetId, 101n)
  expect(data.attestations.map(row => row.evidenceURI)).toEqual(['ipfs://indexed', 'ipfs://tail'])
  expect(data.evidenceFailed).toBe(false)
})

test('without the internal service the whole log is read from the chain', async () => {
  const evidence = vi.fn(fakeReader().evidence)
  const evidenceFrom = vi.fn(fakeReader().evidenceFrom)
  reader.current = fakeReader({ evidence, evidenceFrom })

  const data = await loadTarget(targetId, null)

  expect(evidence).toHaveBeenCalled()
  expect(evidenceFrom).not.toHaveBeenCalled()
  expect(data.attestations.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://old-tail'])
})

test('a vote that is missing from the indexed rows falls back to the log of the chain', async () => {
  const evidence = vi.fn(fakeReader().evidence)
  const evidenceFrom = vi.fn(async () => [] as EvidenceRow[])
  // The indexer knows one vote, and the tail of the chain does not carry the second one.
  indexed.read = async () => ({ rows: [evidenceRow(0, 'ipfs://indexed')], finalizedBlock: 100n })
  reader.current = fakeReader({ evidence, evidenceFrom })

  const data = await loadTarget(targetId, null)

  expect(evidence).toHaveBeenCalled()
  expect(data.attestations.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://old-tail'])
})

test('a chain that cannot be read at all leaves the links unknown, and the votes stay', async () => {
  const evidence = vi.fn(async () => {
    throw new Error('no rpc')
  })
  reader.current = fakeReader({ evidence })

  const data = await loadTarget(targetId, null)

  expect(data.evidenceFailed).toBe(true)
  expect(data.attestations).toHaveLength(2)
  expect(data.detail?.tier).toBe('COMMUNITY_SAFE')
})
