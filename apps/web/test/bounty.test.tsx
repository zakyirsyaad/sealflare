import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BountySummary } from '@sealflare/shared/schemas'
import { BountyList } from '../components/bounty/BountyList'
import { BountyPanel } from '../components/bounty/BountyPanel'
import { BountyTab } from '../components/bounty/BountyTab'
import { canSettle, settleAtOf } from '../lib/bounty/settle'
import { copy } from '../lib/copy'
import { formatUtc } from '../lib/format'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const vault = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
const targetId = `0x${'11'.repeat(32)}`
const label = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

const mocks = vi.hoisted(() => ({
  connection: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isConnected: true, chainId: 56 },
  modulesLive: true,
  holder: true,
  write: vi.fn(),
  block: { timestamp: 1_800_000_000 },
  fetch: vi.fn(),
}))

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  get modulesLive() {
    return mocks.modulesLive
  },
  agentIdUrl: 'https://agent-id.example/get',
}))
vi.mock('../lib/chain/addresses', () => ({
  addresses: () => ({ agentId: me, core: me, court: null, vault }),
}))
vi.mock('wagmi', () => ({
  useConnection: () => mocks.connection,
  useReadContract: (args: { functionName: string }) => ({
    data: args.functionName === 'isAgentIdHolder' ? mocks.holder : 3,
    refetch: vi.fn(),
  }),
  usePublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: 'success' }),
    getBlock: async () => mocks.block,
  }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useConnectors: () => [],
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

/** A bounty as the indexer answers it. */
function bounty(overrides: Partial<BountySummary> = {}): BountySummary {
  return BountySummary.parse({
    id: '7',
    targetId,
    label,
    requester: me,
    slots: 3,
    filled: 1,
    amount: '200000000000000000',
    createdAt: '2026-11-20T00:00:00.000Z',
    settleableAt: null,
    settled: false,
    ...overrides,
  })
}

/** The answer of the bounty list, as the public API sends it. */
function answer(items: BountySummary[]): Response {
  return new Response(JSON.stringify({ success: true, data: { items }, meta: { finalizedBlock: '100' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connection = { address: me, isConnected: true, chainId: 56 }
  mocks.modulesLive = true
  mocks.holder = true
  mocks.block = { timestamp: 1_800_000_000 }
  mocks.write.mockResolvedValue(`0x${'22'.repeat(32)}`)
  mocks.fetch.mockResolvedValue(answer([bounty()]))
  vi.stubGlobal('fetch', mocks.fetch)
})

test('slots are limited to 3 to 5 and the amount to 0.2 BNB', async () => {
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByRole('radio', { name: '3' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '4' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '5' })).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: '2' })).toBeNull()
  expect(screen.queryByRole('radio', { name: '6' })).toBeNull()

  await userEvent.type(screen.getByLabelText(copy.bounty.amountLabel), '0.3')
  await userEvent.click(screen.getByRole('button', { name: copy.bounty.create }))
  expect(await screen.findByRole('alert')).toHaveTextContent('0.2 BNB')
  expect(mocks.write).not.toHaveBeenCalled()
})

test('the summary states all five facts from ux.md section 10', () => {
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByText(copy.bounty.factMajority)).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.factTreasury.replace('{fee}', '5'))).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.factNoCancel)).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.factRefund.replace('{days}', '7'))).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.factRequester)).toBeInTheDocument()
})

test('creating a bounty needs a wallet but not an Agent ID', async () => {
  // A wallet without an Agent ID may still fund a bounty.
  mocks.holder = false
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.queryByText(copy.wallet.agentRequired)).toBeNull()
  await userEvent.type(screen.getByLabelText(copy.bounty.amountLabel), '0.1')
  await userEvent.click(screen.getByRole('button', { name: copy.bounty.create }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('createBounty')
  expect(call.args[0]).toBe(targetId)
  expect(call.args[1]).toBe(3)
  expect(call.value).toBe(100000000000000000n)
  expect(call.approve).toBeUndefined()
})

test('a bounty cannot be funded without a wallet', async () => {
  mocks.connection = { address: undefined, isConnected: false, chainId: 56 }
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByText(copy.bounty.walletNeeded)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.create })).toBeNull()
  expect(mocks.write).not.toHaveBeenCalled()
})

test('a row in the list opens the target page', () => {
  render(<BountyList items={[bounty()]} live />)
  const link = screen.getByRole('link', { name: label })
  expect(link).toHaveAttribute('href', `/app/t/${targetId}`)
})

test('modules not live shows the empty state with the fixed sentence', () => {
  render(<BountyList items={[bounty()]} live={false} />)
  expect(screen.getByText(copy.common.modulesNotLive)).toBeInTheDocument()
  expect(screen.queryByRole('link')).toBeNull()
})

test('Settle appears 48 hours after the last slot, or 7 days after creation', () => {
  const full = bounty({ filled: 3, settleableAt: '2026-11-22T00:00:00.000Z' })
  expect(settleAtOf(full)?.toISOString()).toBe('2026-11-22T00:00:00.000Z')
  expect(canSettle(full, new Date('2026-11-21T23:59:59.000Z'))).toBe(false)
  expect(canSettle(full, new Date('2026-11-22T00:00:00.000Z'))).toBe(true)

  const open = bounty({ filled: 1, settleableAt: null, createdAt: '2026-11-20T00:00:00.000Z' })
  expect(settleAtOf(open)?.toISOString()).toBe('2026-11-27T00:00:00.000Z')
  expect(canSettle(open, new Date('2026-11-26T23:59:59.000Z'))).toBe(false)
  expect(canSettle(open, new Date('2026-11-27T00:00:00.000Z'))).toBe(true)
})

test('the tab shows filled slots and when it can be settled', async () => {
  mocks.block = { timestamp: Math.floor(new Date('2026-11-21T00:00:00.000Z').getTime() / 1000) }
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByText(copy.bounty.filled.replace('{filled}', '2').replace('{slots}', '3'))).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.settleAt.replace('{time}', formatUtc(new Date('2026-11-27T00:00:00.000Z').getTime() / 1000)))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the Settle button appears once the chain says the window has passed', async () => {
  mocks.block = { timestamp: Math.floor(new Date('2026-11-27T00:00:00.000Z').getTime() / 1000) }
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null })]))
  render(<BountyTab targetId={targetId} />)
  const button = await screen.findByRole('button', { name: copy.bounty.settle })
  await userEvent.click(button)
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('settleBounty')
  expect(call.args[0]).toBe(7n)
  expect(call.approve).toBeUndefined()
})

test('a bounty that is already settled offers no settlement', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ settled: true })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByText(copy.bounty.settled)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})
