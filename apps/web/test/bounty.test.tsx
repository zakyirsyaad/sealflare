import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BountySummary } from '@sealflare/shared/schemas'
import type { TrustTier } from '@sealflare/shared/rules'
import { ActionColumn } from '../components/target/ActionColumn'
import { BountyList } from '../components/bounty/BountyList'
import { BountyPanel } from '../components/bounty/BountyPanel'
import { BountyTab } from '../components/bounty/BountyTab'
import { canSettle, settleAtOf, withinBountyBounds } from '../lib/bounty/settle'
import { copy } from '../lib/copy'
import { formatUtc } from '../lib/format'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const vault = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
const targetId = `0x${'11'.repeat(32)}`
const label = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

/**
 * The time of the chain the tests run against.
 *
 * Every date of the fixtures is counted from this moment, so no test depends on the clock of the
 * machine that runs it.
 */
const NOW = Math.floor(Date.UTC(2026, 10, 26, 12, 0, 0) / 1000)

/** The moment of the chain, a number of days ago, as the indexer writes it. */
function daysAgo(days: number): string {
  return new Date((NOW - days * 86_400) * 1000).toISOString()
}

/** The moment of the chain, a number of hours ago. */
function hoursAgo(hours: number): string {
  return new Date((NOW - hours * 3_600) * 1000).toISOString()
}

/** The moment of the chain, a number of days from now. */
function daysFromNow(days: number): string {
  return new Date((NOW + days * 86_400) * 1000).toISOString()
}

const mocks = vi.hoisted(() => ({
  connection: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as string | undefined, isConnected: true, chainId: 56 },
  modulesLive: true,
  holder: true,
  write: vi.fn(),
  block: { timestamp: 1_800_000_000 },
  blockFails: false,
  connectError: null as Error | null,
  fetch: vi.fn(),
  loadBounties: vi.fn(),
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
vi.mock('../server/bounties', () => ({ loadBounties: mocks.loadBounties }))
vi.mock('../lib/env.public', () => ({
  publicEnv: {
    get NEXT_PUBLIC_MODULES_LIVE() {
      return mocks.modulesLive
    },
  },
}))
vi.mock('wagmi', () => ({
  useConnection: () => mocks.connection,
  useReadContract: (args: { functionName: string }) => ({
    data: args.functionName === 'isAgentIdHolder' ? mocks.holder : 3,
    refetch: vi.fn(),
  }),
  usePublicClient: () => ({
    waitForTransactionReceipt: async () => ({ status: 'success' }),
    getBlock: async () => {
      if (mocks.blockFails) throw new Error('the chain could not be read')
      return mocks.block
    },
  }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
  useBlock: () => ({ data: { timestamp: BigInt(mocks.block.timestamp) }, refetch: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isError: false, error: null }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useConnectors: () => [],
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: mocks.connectError }),
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
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
    createdAt: daysAgo(2),
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

/** The actions of the target page, without a scan and without a vote. */
function actionProps() {
  return {
    tier: 'UNRATED' as TrustTier,
    targetType: 'SMART_CONTRACT' as const,
    currentVersionHref: null,
    targetId,
    targetWord: null,
    bundleChanged: false,
    evidenceFailed: false,
    label,
    scan: null,
    attestations: [],
    underDispute: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connection = { address: me, isConnected: true, chainId: 56 }
  mocks.modulesLive = true
  mocks.holder = true
  mocks.block = { timestamp: NOW }
  mocks.blockFails = false
  mocks.connectError = null
  mocks.write.mockResolvedValue(`0x${'22'.repeat(32)}`)
  mocks.fetch.mockResolvedValue(answer([bounty()]))
  mocks.loadBounties.mockResolvedValue([bounty()])
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
  expect(await screen.findByRole('alert')).toHaveTextContent('That bounty is above the 0.2 BNB limit.')
  expect(mocks.write).not.toHaveBeenCalled()
})

test('the summary states all five facts from ux.md section 10', () => {
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByText('The payout goes to the majority of the Guardians who filled a slot, whatever their verdict is.')).toBeInTheDocument()
  expect(screen.getByText('5% of the payout goes to the treasury.')).toBeInTheDocument()
  expect(screen.getByText('A bounty cannot be cancelled.')).toBeInTheDocument()
  expect(screen.getByText('Slots that stay empty are returned to you after 7 days.')).toBeInTheDocument()
  expect(screen.getByText('Your own attestation does not fill a slot.')).toBeInTheDocument()
})

test('the summary is told before the wallet is opened', () => {
  mocks.connection = { address: undefined, isConnected: false, chainId: 56 }
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByText(copy.bounty.walletNeeded)).toBeInTheDocument()
  expect(screen.getByText('The payout goes to the majority of the Guardians who filled a slot, whatever their verdict is.')).toBeInTheDocument()
  expect(screen.getByText('A bounty cannot be cancelled.')).toBeInTheDocument()
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

test('the amount at the limit is sent as it is shown, and the panel waits for the finality', async () => {
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText(copy.bounty.amountLabel), '0.2')
  await userEvent.click(screen.getByRole('button', { name: copy.bounty.create }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].value).toBe(200000000000000000n)
  // The bounty is on its way, so a second payment is not asked for.
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute(
    'href',
    `https://bscscan.com/tx/0x${'22'.repeat(32)}`,
  )
  expect(screen.queryByRole('button', { name: copy.bounty.create })).toBeNull()
})

test('a write that fails names the reason and offers a retry', async () => {
  mocks.write.mockRejectedValueOnce(new Error('the vault said no'))
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText(copy.bounty.amountLabel), '0.1')
  await userEvent.click(screen.getByRole('button', { name: copy.bounty.create }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Something went wrong. Try again.')
  // The button of the panel is gone, so the retry is the only action offered.
  expect(screen.queryByRole('button', { name: copy.bounty.create })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2))
})

test('a write the wallet refuses goes back to the summary, without a message', async () => {
  const refused = Object.assign(new Error('the user refused'), { code: 4001 })
  mocks.write.mockRejectedValueOnce(refused)
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  await userEvent.type(screen.getByLabelText(copy.bounty.amountLabel), '0.1')
  await userEvent.click(screen.getByRole('button', { name: copy.bounty.create }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.bounty.create })).toBeEnabled()
})

test('a wallet that cannot be connected is named', () => {
  mocks.connection = { address: undefined, isConnected: false, chainId: 56 }
  mocks.connectError = new Error('the wallet refused')
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not connect. Try again or choose another wallet.')
})

test('the slots move with the arrow keys', async () => {
  render(<BountyPanel targetId={targetId} onClose={() => {}} />)
  const first = screen.getByRole('radio', { name: '3' })
  first.focus()
  await userEvent.keyboard('{ArrowDown}')
  expect(screen.getByRole('radio', { name: '4' })).toHaveAttribute('aria-checked', 'true')
  expect(first).toHaveAttribute('aria-checked', 'false')
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

test('the list shows the open bounties, and not the ones that cannot be filled', () => {
  render(<BountyList items={[bounty({ filled: 3, settled: true })]} live />)
  expect(screen.queryByRole('link', { name: label })).toBeNull()
  expect(screen.getByText(copy.bounty.empty)).toBeInTheDocument()
})

test('modules not live shows the empty state with the fixed sentence', () => {
  render(<BountyList items={[bounty()]} live={false} />)
  expect(screen.getByText('Opens when the dispute and vault contracts go live.')).toBeInTheDocument()
  expect(screen.queryByRole('link')).toBeNull()
})

test('the settle window is 48 hours after the last slot, or 7 days after creation', () => {
  const full = bounty({ filled: 3, createdAt: daysAgo(3), settleableAt: hoursAgo(1) })
  expect(settleAtOf(full)?.toISOString()).toBe(hoursAgo(1))
  expect(canSettle(full, new Date((NOW - 7_200) * 1000))).toBe(false)
  expect(canSettle(full, new Date(NOW * 1000))).toBe(true)

  const open = bounty({ filled: 1, settleableAt: null, createdAt: daysAgo(2) })
  expect(settleAtOf(open)?.toISOString()).toBe(daysFromNow(5))
  expect(canSettle(open, new Date((NOW + 5 * 86_400 - 1) * 1000))).toBe(false)
  expect(canSettle(open, new Date((NOW + 5 * 86_400) * 1000))).toBe(true)
})

test('a bounty whose slots are full can be settled 48 hours after the last slot', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 3, slots: 3, createdAt: daysAgo(3), settleableAt: hoursAgo(1) })]))
  render(<BountyTab targetId={targetId} />)
  const button = await screen.findByRole('button', { name: copy.bounty.settle })
  await userEvent.click(button)
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('settleBounty')
  expect(call.args[0]).toBe(7n)
  expect(call.approve).toBeUndefined()
})

test('a full bounty without a known moment waits for the seven days', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 3, slots: 3, settleableAt: null, createdAt: daysAgo(2) })]))
  render(<BountyTab targetId={targetId} />)
  // The seven days are not over yet, so no settlement is offered.
  expect(await screen.findByText(copy.bounty.settleAt.replace('{time}', formatUtc((NOW + 5 * 86_400)))))
    .toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('a full bounty without a known moment is settled once the seven days are over', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 3, slots: 3, settleableAt: null, createdAt: daysAgo(8) })]))
  render(<BountyTab targetId={targetId} />)
  const button = await screen.findByRole('button', { name: copy.bounty.settle })
  await userEvent.click(button)
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.write.mock.calls[0]![0].functionName).toBe('settleBounty')
})

test('the bounds of the bounty are the ones of the contract', () => {
  expect(withinBountyBounds(3, 200000000000000000n)).toBe(true)
  expect(withinBountyBounds(2, 200000000000000000n)).toBe(false)
  expect(withinBountyBounds(6, 200000000000000000n)).toBe(false)
  expect(withinBountyBounds(3, 200000000000000001n)).toBe(false)
  expect(withinBountyBounds(3, 0n)).toBe(false)
})

test('the tab shows filled slots and when it can be settled', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null, createdAt: daysAgo(2) })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByText('2 of 3 slots filled')).toBeInTheDocument()
  expect(screen.getByText(copy.bounty.settleAt.replace('{time}', formatUtc(NOW + 5 * 86_400)))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the Settle button appears once the chain says the window has passed', async () => {
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null, createdAt: daysAgo(8) })]))
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

test('the chain time that could not be read is named, and no settlement is offered', async () => {
  mocks.blockFails = true
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 3, slots: 3, createdAt: daysAgo(8), settleableAt: hoursAgo(1) })]))
  render(<BountyTab targetId={targetId} />)
  expect(
    await screen.findByText(
      'The time of the chain could not be read, so it is not known whether this bounty can be settled now.',
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the settlement asks for a wallet when there is none', async () => {
  mocks.connection = { address: undefined, isConnected: false, chainId: 56 }
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null, createdAt: daysAgo(8) })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByText(copy.bounty.settleWalletNeeded)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the settlement is closed on the wrong network', async () => {
  mocks.connection = { address: me, isConnected: true, chainId: 1 }
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 2, slots: 3, settleableAt: null, createdAt: daysAgo(8) })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByRole('button', { name: 'Switch to BNB Smart Chain' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the modules that are not live close the settlement', async () => {
  mocks.modulesLive = false
  mocks.fetch.mockResolvedValue(answer([bounty({ filled: 3, slots: 3, createdAt: daysAgo(8), settleableAt: hoursAgo(1) })]))
  render(<BountyTab targetId={targetId} />)
  expect(await screen.findByText('Opens when the dispute and vault contracts go live.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.bounty.settle })).toBeNull()
})

test('the failed state of the tab names the failure and reads again', async () => {
  mocks.fetch.mockRejectedValue(new Error('the indexer is down'))
  render(<BountyTab targetId={targetId} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(copy.bounty.loadFailed)
  expect(alert).toHaveTextContent(copy.common.onChainSafe)
  mocks.fetch.mockResolvedValue(answer([bounty()]))
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  expect(await screen.findByText('1 of 3 slots filled')).toBeInTheDocument()
})

test('the fund button of the target page is closed while the modules are not live', () => {
  mocks.modulesLive = false
  render(<ActionColumn {...actionProps()} />)
  const button = screen.getByRole('button', { name: copy.target.fundBounty })
  expect(button).toBeDisabled()
  expect(screen.getAllByText('Opens when the dispute and vault contracts go live.').length).toBeGreaterThan(0)
})

test('the fund button of the target page opens the panel', async () => {
  render(<ActionColumn {...actionProps()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.target.fundBounty }))
  expect(await screen.findByRole('radio', { name: '3' })).toBeInTheDocument()
})

test('the page shows the fixed sentence while the modules are not live', async () => {
  mocks.modulesLive = false
  const Page = (await import('../app/app/bounties/page')).default
  render(await Page())
  expect(screen.getByText('Opens when the dispute and vault contracts go live.')).toBeInTheDocument()
  expect(mocks.loadBounties).not.toHaveBeenCalled()
})

test('the page lists the bounties the indexer read', async () => {
  const Page = (await import('../app/app/bounties/page')).default
  render(await Page())
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/app/t/${targetId}`)
})

test('the page says the bounties could not be read', async () => {
  mocks.loadBounties.mockRejectedValue(new Error('the internal service is down'))
  const Page = (await import('../app/app/bounties/page')).default
  render(await Page())
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(copy.bounty.readFailed)
  expect(screen.getByRole('link', { name: copy.common.retry })).toHaveAttribute('href', '/app/bounties')
})
