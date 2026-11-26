import { beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const ACCOUNT = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const OTHER = '0x2000000000000000000000000000000000000002'
const CORE = '0x1000000000000000000000000000000000000001'
const VAULT = '0x3000000000000000000000000000000000000003'
const TARGET = `0x${'ab'.repeat(32)}`
const TX_HASH = `0x${'cd'.repeat(32)}`
/** A moment that is still ahead of the reader, so a countdown never reads as due. */
const LATER = '2099-01-01T00:00:00.000Z'

/** The chain reads the screen makes, keyed by the function it calls. */
const chain = vi.hoisted(() => ({
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
  pendingSettlement: 5,
  penalties: {} as Record<string, number>,
  write: vi.fn(),
  receipt: { isSuccess: true, isError: false, data: { status: 'success' }, error: null },
}))

vi.mock('wagmi', async () => {
  const react = await import('react')
  return {
    useReadContract: (config: { functionName: string }) => ({
      data: (chain as unknown as Record<string, unknown>)[config.functionName],
      refetch: vi.fn(),
      isLoading: false,
      isError: false,
    }),
    // The chain reads again after a refetch, and the screen is drawn again with the new answer.
    useReadContracts: (config: { contracts: { functionName: string; args: readonly unknown[] }[] }) => {
      const [, bump] = react.useState(0)
      const data = config.contracts.map(contract =>
        contract.functionName === 'pendingPenalties' ? (chain.penalties[String(contract.args[0])] ?? 0) : undefined,
      )
      return { data, refetch: () => bump(value => value + 1), isLoading: false, isError: false }
    },
    useWriteContract: () => ({ writeContractAsync: chain.write }),
    useWaitForTransactionReceipt: () => chain.receipt,
    useConnection: () => ({ isConnected: true, address: ACCOUNT, chainId: 56, isReconnecting: false }),
    useDisconnect: () => ({ mutate: vi.fn() }),
    useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
    useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
    useConnectors: () => [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
  }
})

const account = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => account.state }))

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: true,
  agentIdUrl: 'https://agent-id.example/get',
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/app/me' }))

import MyActivityPage from '../app/app/me/page'
import { AppHeader } from '../components/AppHeader'
import { copy } from '../lib/copy'

/** The activity the indexer answers with. */
function activity(overrides: { needsAction?: unknown[]; history?: unknown[]; balance?: string } = {}) {
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
function need(overrides: Record<string, unknown> = {}) {
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
function historyItem(overrides: Record<string, unknown> = {}) {
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

let answer: unknown = activity()

beforeEach(() => {
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
  chain.pendingSettlement = 5
  chain.penalties = {}
  chain.write.mockResolvedValue(TX_HASH)
  account.state = { kind: 'holder', address: ACCOUNT, isLoading: false, isError: false, recheck: () => {} }
  answer = activity()
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => answer })))
})

test('needs action comes first, ordered by urgency, and disappears when empty', async () => {
  answer = activity({
    needsAction: [
      need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' }),
      need({ dueAt: '2099-06-01T00:00:00.000Z' }),
    ],
    history: [historyItem()],
  })
  render(<MyActivityPage />)
  await screen.findByRole('heading', { name: copy.activity.needsAction })
  const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
  expect(headings[0]).toBe(copy.activity.needsAction)
  const rows = screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)
  expect(rows[0]).toContain('Reveal your vote')
  expect(rows[1]).toBe(copy.activity.claimTitle)

  cleanup()
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await screen.findByRole('heading', { name: copy.activity.history })
  expect(screen.queryByRole('heading', { name: copy.activity.needsAction })).toBeNull()
})

test('a due reveal names the stake at risk and links to the reveal', async () => {
  answer = activity({ needsAction: [need()], history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText('Your 0.005 BNB stake is lost if you do not reveal in time.')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: copy.activity.revealAction })
  expect(link).toHaveAttribute('href', '/app/disputes/12')
  expect(screen.getByText(/due in/)).toBeInTheDocument()
})

test('the balance comes from Vault.balanceOf and Withdraw sends the whole balance', async () => {
  answer = activity({ balance: '9990000000000000000', history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText('0.015')).toBeInTheDocument()
  expect(screen.queryByText('9.99')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: copy.activity.withdraw }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'withdraw', args: [], address: VAULT }),
    ),
  )
  expect(screen.getByText(copy.activity.withdrawGas)).toBeInTheDocument()
})

test('Withdraw is not offered with a zero balance', async () => {
  chain.balanceOf = 0n
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceEmpty)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.withdraw })).toBeNull()
})

test('standing shows score, vote weight, distance to the next weight and attestations left today', async () => {
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText('Vote weight 2 of 5')).toBeInTheDocument()
  expect(screen.getByText('13 more reputation to reach weight 3.')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('3 of 5')).toBeInTheDocument()
})

test('Claim calls settle for the page of attestations that contains mine and says it costs gas', async () => {
  answer = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.claimAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'settle', args: [TARGET, 50, 50], address: CORE }),
    ),
  )
  expect(screen.getByText(copy.activity.settleGas)).toBeInTheDocument()
})

test('Apply penalties pages through in chunks and shows how many remain', async () => {
  chain.penalties = { [TARGET]: 120 }
  chain.write.mockImplementation(async () => {
    chain.penalties[TARGET] = 70
    return TX_HASH
  })
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText('120 penalties remain')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 0, 50], address: CORE }),
    ),
  )
  expect(await screen.findByText('70 penalties remain')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 50, 50] }),
    ),
  )
})

test('an account with no history sees one invitation: scan a first target', async () => {
  answer = activity()
  render(<MyActivityPage />)
  const invitation = await screen.findByRole('link', { name: copy.activity.scanFirst })
  expect(invitation).toHaveAttribute('href', '/app')
  expect(screen.queryByRole('table')).toBeNull()
})

test('the wallet button badge equals the number of needs-action items', async () => {
  answer = activity({ needsAction: [need(), need({ kind: 'CAN_CLOSE' })], history: [historyItem()] })
  render(<AppHeader />)
  await waitFor(() => expect(screen.getByRole('button', { name: /2 items need action/ })).toBeInTheDocument())
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('this page asks for a wallet and shows nothing personal without one', async () => {
  account.state = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  render(<MyActivityPage />)
  expect(screen.getByText(copy.activity.needWallet)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.nav.connectWallet })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: copy.activity.history })).toBeNull()
  expect(screen.queryByRole('heading', { name: copy.activity.balanceToWithdraw })).toBeNull()
  expect(screen.queryByRole('heading', { name: copy.activity.standing })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
