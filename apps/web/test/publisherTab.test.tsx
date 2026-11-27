import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { targetIdOfContract } from '@sealflare/shared/rules'
import type { Hex } from 'viem'
import { PublisherTab, type PublisherTabProps } from '../components/target/PublisherTab'
import { copy } from '../lib/copy'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const target = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const targetId = targetIdOfContract(target as `0x${string}`)
const vault = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

const mocks = vi.hoisted(() => ({
  connection: { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', isConnected: true, chainId: 56 },
  bond: { amount: 0n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n },
  write: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: true,
  agentIdUrl: 'https://agent-id.example/get',
}))
vi.mock('../lib/chain/addresses', () => ({
  addresses: () => ({ agentId: me, core: me, court: null, vault }),
  coreAddress: () => me,
  vaultAddress: () => vault,
}))
vi.mock('wagmi', () => ({
  useConnection: () => mocks.connection,
  useReadContract: () => ({ data: mocks.bond, refetch: mocks.refetch }),
  usePublicClient: () => ({ waitForTransactionReceipt: async () => ({ status: 'success' }) }),
  useWriteContract: () => ({ mutateAsync: mocks.write }),
}))

function props(overrides: Partial<PublisherTabProps> = {}): PublisherTabProps {
  return {
    targetId: targetId as Hex,
    role: 'VERIFIED_PUBLISHER',
    publisher: me as `0x${string}`,
    method: 'OWNER',
    bond: { amount: '500000000000000000', withdrawalAvailableAt: null, lockedByChallengeId: null },
    ...overrides,
  }
}

/** The facts sit in one paragraph, so the text is looked up as a part of it. */
function byText(text: string): HTMLElement {
  return screen.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connection = { address: me, isConnected: true, chainId: 56 }
  mocks.bond = { amount: 0n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  mocks.write.mockResolvedValue(`0x${'22'.repeat(32)}` as Hex)
  mocks.refetch.mockResolvedValue({})
})

test('the Publisher tab shows role, how ownership was proven, bond per depositor and withdrawal status', () => {
  render(<PublisherTab {...props()} />)
  expect(byText(copy.publish.verifiedPublisher)).toBeInTheDocument()
  expect(byText(copy.publisher.proofOwner)).toBeInTheDocument()
  expect(screen.getByText(/Bond of the publisher:/)).toHaveTextContent('0.5 BNB')
  expect(screen.getAllByText(copy.publisher.bondNone).length).toBeGreaterThan(0)
})

test('the Publisher tab shows the state of the withdrawal of the bond of the publisher', () => {
  const now = Math.floor(Date.now() / 1000)
  render(
    <PublisherTab
      {...props({
        bond: { amount: '500000000000000000', withdrawalAvailableAt: now + 7 * 86_400, lockedByChallengeId: null },
      })}
    />,
  )
  expect(screen.getByText(/The withdrawal was requested/)).toBeInTheDocument()
})

test('the Publisher tab says the bond of the publisher cannot be withdrawn while it is locked', () => {
  render(
    <PublisherTab
      {...props({
        bond: { amount: '500000000000000000', withdrawalAvailableAt: null, lockedByChallengeId: '5' },
      })}
    />,
  )
  expect(screen.getByText(copy.publisher.bondLocked)).toBeInTheDocument()
})

test('a target that was bound by its deployer says so', () => {
  render(<PublisherTab {...props({ method: 'DEPLOYER' })} />)
  expect(byText(copy.publisher.proofDeployer)).toBeInTheDocument()
})

test('a target whose binding is unknown says that it is unknown', () => {
  render(<PublisherTab {...props({ method: null })} />)
  expect(byText(copy.publisher.proofUnknown)).toBeInTheDocument()
})

test('the depositor sees Deposit bond, Request withdrawal, and Finalize withdrawal only after 7 days', async () => {
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  render(<PublisherTab {...props()} />)
  expect(screen.getByRole('button', { name: copy.publisher.deposit })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.publisher.requestWithdrawal })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.publisher.finalizeWithdrawal })).toBeNull()
})

test('the withdrawal can only be finalized after the waiting time has passed', () => {
  const now = Math.floor(Date.now() / 1000)
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: BigInt(now + 7 * 86_400), lockedByChallengeId: 0n }
  const { rerender } = render(<PublisherTab {...props()} />)
  expect(screen.queryByRole('button', { name: copy.publisher.finalizeWithdrawal })).toBeNull()
  expect(screen.getByText(/The withdrawal was requested/)).toBeInTheDocument()
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: BigInt(now - 60), lockedByChallengeId: 0n }
  rerender(<PublisherTab {...props()} />)
  expect(screen.getByRole('button', { name: copy.publisher.finalizeWithdrawal })).toBeInTheDocument()
})

test('a locked bond explains it cannot be withdrawn during the dispute', () => {
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: 0n, lockedByChallengeId: 5n }
  render(<PublisherTab {...props()} />)
  expect(screen.getByText(copy.publisher.bondLocked)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.publisher.requestWithdrawal })).toBeNull()
  expect(screen.queryByRole('button', { name: copy.publisher.finalizeWithdrawal })).toBeNull()
})

test('a wallet that is not the publisher cannot post a bond', () => {
  render(<PublisherTab {...props({ publisher: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as `0x${string}` })} />)
  expect(screen.queryByRole('button', { name: copy.publisher.deposit })).toBeNull()
  expect(screen.getByText(copy.publisher.notPublisher)).toBeInTheDocument()
})

test('requesting a withdrawal writes it from the wallet of the depositor', async () => {
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  render(<PublisherTab {...props()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.publisher.requestWithdrawal }))
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(mocks.write.mock.calls[0]![0].functionName).toBe('requestBondWithdrawal')
})

test('posting a bond writes a deposit of BNB, without approving any token', async () => {
  mocks.bond = { amount: 0n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  render(<PublisherTab {...props()} />)
  await userEvent.type(screen.getByLabelText(copy.publish.bondAmount), '0.1')
  await userEvent.click(screen.getByRole('button', { name: copy.publisher.deposit }))
  expect(mocks.write).toHaveBeenCalledTimes(1)
  const call = mocks.write.mock.calls[0]![0]
  expect(call.functionName).toBe('depositBond')
  expect(call.value).toBe(100000000000000000n)
  expect(call.approve).toBeUndefined()
})

test('finalizing a withdrawal writes it from the wallet of the depositor', async () => {
  const now = Math.floor(Date.now() / 1000)
  mocks.bond = { amount: 100000000000000000n, withdrawalAvailableAt: BigInt(now - 60), lockedByChallengeId: 0n }
  render(<PublisherTab {...props()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.publisher.finalizeWithdrawal }))
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(mocks.write.mock.calls[0]![0].functionName).toBe('finalizeBondWithdrawal')
})

test('the bond is read again after a withdrawal request is confirmed', async () => {
  mocks.bond = { amount: 500_000_000_000_000_000n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  render(<PublisherTab {...props()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.publisher.requestWithdrawal }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1))
})

test('the bond is not read again when the withdrawal request was not confirmed', async () => {
  mocks.bond = { amount: 500_000_000_000_000_000n, withdrawalAvailableAt: 0n, lockedByChallengeId: 0n }
  mocks.write.mockRejectedValue(new Error('rejected'))
  render(<PublisherTab {...props()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.publisher.requestWithdrawal }))
  await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  expect(mocks.refetch).not.toHaveBeenCalled()
})
