import { vi } from 'vitest'

/** The account the screen is read for. */
export const ACCOUNT = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
/** Another account, so a change of account can be seen. */
export const OTHER = '0x2000000000000000000000000000000000000002'
export const CORE = '0x1000000000000000000000000000000000000001'
export const VAULT = '0x3000000000000000000000000000000000000003'
export const TARGET = `0x${'ab'.repeat(32)}`
export const TX_HASH = `0x${'cd'.repeat(32)}`
/** A moment that is still ahead of the reader, so a countdown never reads as due. */
export const LATER = '2099-01-01T00:00:00.000Z'
/** A moment that is behind the chain, so a deadline of it is over. */
export const PASSED = '2020-01-01T00:00:00.000Z'

/** The chain reads the screen makes, keyed by the function it calls. */
export const chain = {
  balanceOf: 15_000_000_000_000_000n,
  getGuardian: {
    exists: true,
    score: 12,
    createdAtBlock: 1n,
    attestationCount: 3n,
    lastAttestDay: 1n,
    attestsToday: 2n,
  },
  weightOf: 2,
  attestationsLeftToday: 3,
  attestationIndexOf: [true, 52] as [boolean, number],
  getAttestation: { settled: false } as { settled: boolean },
  pendingSettlement: 5,
  penalties: {} as Record<string, number>,
  targets: {} as Record<string, { attestationCount: number }>,
  /** The attestations of the targets, as the contract holds them. */
  attestations: {} as Record<number, { verdict: number; penalized: boolean }>,
  readsFailed: false,
  /** The reads that answer nothing, as if the chain had not answered yet. */
  pending: [] as string[],
  /** The read of the targets fails, as if the chain could not name them. */
  targetsFailed: false,
  /** The window of attestations cannot be read, as if the chain could not answer. */
  rangeFailed: false,
  /** The read of the window of attestations waits for the test. */
  holdRange: false,
  /** The answer of the indexer waits for the test. */
  holdFetch: false,
  /** When set, the answer of the chain waits for the test to release it. */
  holdReads: false,
  /** The answers that wait for the test. */
  releases: [] as (() => void)[],
  release: null as (() => void) | null,
  /** How many times every read was asked again. */
  refetches: {} as Record<string, number>,
  write: vi.fn(),
  receipt: {
    isSuccess: true,
    isError: false,
    data: { status: 'success' } as { status: string } | null,
    error: null as Error | null,
  },
}

/** The account of the wallet, as the screen reads it. */
export const account = { state: {} as Record<string, unknown> }
/** Whether the contracts of the screen are open yet. */
export const modules = { live: true }
/** The activity the indexer answers with. */
export const answer: { current: unknown } = { current: null }

/** The activity the indexer answers with. */
export function activity(overrides: { needsAction?: unknown[]; history?: unknown[]; balance?: string } = {}) {
  return {
    success: true,
    data: {
      needsAction: overrides.needsAction ?? [],
      balance: overrides.balance ?? '0',
      score: 0,
      weight: 1,
      toNextWeight: null,
      history: overrides.history ?? [],
    },
    meta: { finalizedBlock: '100' },
  }
}

/** One action that waits on the account. */
export function need(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'REVEAL_DUE',
    targetId: TARGET,
    challengeId: '12',
    dueAt: LATER,
    detail: 'The reveal window of this challenge closes soon.',
    ...overrides,
  }
}

/** One row of the history. */
export function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'attestation',
    targetId: TARGET,
    label: 'demo-drainer-skill',
    result: 'Recorded',
    xp: 2,
    at: '2026-11-20T08:00:00.000Z',
    ...overrides,
  }
}

/** Puts the chain and the account back to the state a test starts from. */
export function resetActivity() {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: OTHER,
    core: CORE,
    court: VAULT,
    vault: VAULT,
  })
  chain.balanceOf = 15_000_000_000_000_000n
  chain.getGuardian = {
    exists: true,
    score: 12,
    createdAtBlock: 1n,
    attestationCount: 3n,
    lastAttestDay: 1n,
    attestsToday: 2n,
  }
  chain.weightOf = 2
  chain.attestationsLeftToday = 3
  chain.attestationIndexOf = [true, 52]
  chain.getAttestation = { settled: false }
  chain.pendingSettlement = 5
  chain.penalties = {}
  chain.targets = { [TARGET]: { attestationCount: 120 } }
  chain.attestations = {}
  chain.readsFailed = false
  chain.pending = []
  chain.targetsFailed = false
  chain.rangeFailed = false
  chain.holdRange = false
  chain.holdFetch = false
  chain.holdReads = false
  chain.releases = []
  chain.refetches = {}
  chain.release = () => {
    const held = chain.releases
    chain.releases = []
    for (const deliver of held) deliver()
  }
  chain.receipt = { isSuccess: true, isError: false, data: { status: 'success' }, error: null }
  chain.write.mockReset()
  chain.write.mockResolvedValue(TX_HASH)
  modules.live = true
  account.state = { kind: 'holder', address: ACCOUNT, isLoading: false, isError: false, recheck: () => {} }
  answer.current = activity()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      // The indexer is slow, so the answer of the test waits for it.
      if (chain.holdFetch) {
        await new Promise<void>(resolve => {
          chain.releases.push(resolve)
        })
      }
      return { json: async () => answer.current }
    }),
  )
}
