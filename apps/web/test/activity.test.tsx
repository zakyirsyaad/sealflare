import { beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  targets: {} as Record<string, { attestationCount: number }>,
  readsFailed: false,
  /** When set, the answer of the chain waits for the test to release it. */
  holdReads: false,
  release: null as (() => void) | null,
  write: vi.fn(),
  receipt: { isSuccess: true, isError: false, data: { status: 'success' } as { status: string } | null, error: null as Error | null },
}))

vi.mock('wagmi', async () => {
  const react = await import('react')
  return {
    // The chain reads again after a refetch, and the screen is drawn again with the new answer.
    useReadContract: (config: { functionName: string; address?: string }) => {
      const [, bump] = react.useState(0)
      // A read without a contract has no answer, the same as a read that is not enabled.
      const data =
        chain.readsFailed || config.address === undefined
          ? undefined
          : (chain as unknown as Record<string, unknown>)[config.functionName]
      return { data, refetch: () => bump(value => value + 1), isLoading: false, isError: chain.readsFailed }
    },
    useReadContracts: (config: { contracts: { functionName: string; args: readonly unknown[] }[] }) => {
      const [version, bump] = react.useState(0)
      const store = react.useRef<{ signature: string; data: unknown } | null>(null)
      const signature = config.contracts.map(contract => `${contract.functionName}:${String(contract.args[0])}`).join('|')
      const compute = () =>
        config.contracts.map(contract => {
          if (contract.functionName === 'pendingPenalties') return chain.penalties[String(contract.args[0])] ?? 0
          if (contract.functionName === 'getTarget') return chain.targets[String(contract.args[0])] ?? null
          return undefined
        })
      if (store.current === null || store.current.signature !== signature) {
        store.current = { signature, data: compute() }
      }
      // The answer of the chain arrives after the call. A held answer waits for the test.
      const refetch = () => {
        const next = compute()
        const sig = signature
        const deliver = () => {
          store.current = { signature: sig, data: next }
          bump(value => value + 1)
        }
        if (chain.holdReads) chain.release = deliver
        else deliver()
      }
      return {
        data: chain.readsFailed ? undefined : store.current.data,
        dataUpdatedAt: version,
        refetch,
        isLoading: false,
        isError: chain.readsFailed,
      }
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

const modules = vi.hoisted(() => ({ live: true }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  get modulesLive() {
    return modules.live
  },
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
  chain.targets = { [TARGET]: { attestationCount: 120 } }
  chain.readsFailed = false
  chain.holdReads = false
  modules.live = true
  chain.release = null
  chain.receipt = { isSuccess: true, isError: false, data: { status: 'success' }, error: null }
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
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
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
  expect(screen.getAllByRole('link', { name: copy.activity.scanFirst })).toHaveLength(1)
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

test('the rows of the previous account are not shown while the next one loads', async () => {
  let current = activity({ needsAction: [need()], history: [historyItem()] })
  let calls = 0
  const pending: { release: (() => void) | null } = { release: null }
  vi.stubGlobal('fetch', vi.fn(() => {
    calls += 1
    if (calls === 1) return Promise.resolve({ json: async () => current })
    return new Promise(resolve => {
      pending.release = () => resolve({ json: async () => current })
    })
  }))
  const { rerender } = render(<MyActivityPage />)
  expect(await screen.findByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeInTheDocument()
  account.state = { kind: 'holder', address: OTHER, isLoading: false, isError: false, recheck: () => {} }
  current = activity({ history: [historyItem()] })
  rerender(<MyActivityPage />)
  expect(screen.queryByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeNull()
  pending.release?.()
  expect(await screen.findByRole('heading', { name: copy.activity.history })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeNull()
})

test('a chain read that fails shows the failed state and no balance', async () => {
  chain.readsFailed = true
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceFailed)).toBeInTheDocument()
  expect(screen.getByText(copy.activity.standingFailed)).toBeInTheDocument()
  expect(screen.queryByText('0.015')).toBeNull()
  expect(screen.queryByText('Vote weight 2 of 5')).toBeNull()
})

test('a waiting transaction shows the link to the transaction', async () => {
  chain.receipt = { isSuccess: false, isError: false, data: null, error: null }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  expect(await screen.findByRole('button', { name: copy.common.waitingConfirmation })).toBeDisabled()
  const link = await screen.findByRole('link', { name: copy.target.transaction })
  expect(link).toHaveAttribute('href', `https://bscscan.com/tx/${TX_HASH}`)
})

test('the withdrawal can be used again once the chain shows the new balance', async () => {
  // Every transaction has a hash of its own, and the chain shows the balance that is left.
  let calls = 0
  chain.write.mockImplementation(async () => {
    calls += 1
    chain.balanceOf = 30_000_000_000_000_000n
    return `0x${calls.toString(16).padStart(64, '0')}`
  })
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  await waitFor(() => expect(chain.write).toHaveBeenCalledTimes(2))
})

test('the last page of penalties covers only the attestations that are left', async () => {
  // Every transaction has a hash of its own, so the button is free again after each page.
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 0, 50] })),
  )
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 50, 50] })),
  )
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 100, 20] })),
  )
  expect(await screen.findByText(copy.activity.penaltiesCovered)).toBeInTheDocument()
})

test('the last page of penalties says how many penalties it applied', async () => {
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    chain.penalties[TARGET] = 70
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText('The last page applied 50 penalties.')).toBeInTheDocument()
})

test('a page of penalties that applied nothing says so', async () => {
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(copy.activity.penaltiesNone)).toBeInTheDocument()
})

test('a deployment that names no contract shows the failed state', async () => {
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({ chainId: 56 })
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceFailed)).toBeInTheDocument()
  expect(screen.getByText(copy.activity.standingFailed)).toBeInTheDocument()
  expect(screen.queryByText('0.015')).toBeNull()
})

test('the count of the needs-action panel is the count of the mark on the wallet button', async () => {
  answer = activity({ needsAction: [need(), need({ kind: 'CAN_CLOSE' })], history: [historyItem()] })
  render(
    <>
      <AppHeader />
      <MyActivityPage />
    </>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /2 items need action/ })).toBeInTheDocument())
  const panel = await screen.findByRole('region', { name: copy.activity.needsAction })
  expect(within(panel).getByText('2')).toBeInTheDocument()
})

test('the mark on the wallet button is read again after a settlement', async () => {
  answer = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  render(
    <>
      <AppHeader />
      <MyActivityPage />
    </>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /1 item needs action/ })).toBeInTheDocument())
  answer = activity({ history: [historyItem()] })
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.claimAction }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /1 item needs action/ })).toBeNull())
})

test('the last page of penalties waits for the chain before it says what it applied', async () => {
  // The chain answers the read after the page was mined, so the screen may not say what the page
  // applied before the new number has arrived.
  chain.holdReads = true
  chain.write.mockImplementation(async () => {
    chain.penalties[TARGET] = 70
    return TX_HASH
  })
  chain.penalties = { [TARGET]: 120 }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.queryByText(copy.activity.penaltiesNone)).toBeNull()
  expect(screen.queryByText(copy.activity.penaltiesApplied)).toBeNull()
  chain.release?.()
  expect(await screen.findByText('The last page applied 50 penalties.')).toBeInTheDocument()
})

test('a page of penalties that the wallet refused says nothing about what it applied', async () => {
  chain.write.mockRejectedValue({ code: 4001 })
  chain.penalties = { [TARGET]: 120 }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() => expect(chain.write).toHaveBeenCalled())
  expect(screen.queryByText(copy.activity.penaltiesNone)).toBeNull()
  expect(screen.queryByText(copy.activity.penaltiesApplied)).toBeNull()
})

test('the balance shows the note of ux.md 4.2 while the vault is not open yet', async () => {
  modules.live = false
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({ chainId: 56, agentId: OTHER, core: CORE })
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.common.modulesNotLive)).toBeInTheDocument()
  expect(screen.queryByText(copy.activity.balanceFailed)).toBeNull()
  expect(screen.queryByRole('button', { name: copy.activity.withdraw })).toBeNull()
})

test('a wallet without an Agent ID is offered the way to get one', async () => {
  account.state = { kind: 'no-agent-id', address: ACCOUNT, isLoading: false, isError: false, recheck: () => {} }
  answer = activity({ history: [historyItem()] })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.wallet.agentWhy)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.wallet.getAgentId })).toHaveAttribute('href', 'https://agent-id.example/get')
  expect(screen.getByRole('button', { name: copy.wallet.checkAgain })).toBeInTheDocument()
})

test('a chain read that fails shows the failed state of the claim button', async () => {
  chain.readsFailed = true
  answer = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  render(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.claimFailed)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.claimAction })).toBeNull()
})
