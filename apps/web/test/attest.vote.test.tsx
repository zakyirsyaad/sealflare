import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { evidenceHashOf, type SignalGroup } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  receipt: { current: { isSuccess: false, isError: false, error: null as unknown } },
}))
vi.mock('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: () => wagmi.receipt.current,
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useConnectors: () => [],
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => state.value }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: false,
  agentIdUrl: 'https://agent-id.example/get',
}))

const uploadEvidence = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api: { uploadEvidence } }
})

import { ActionColumn } from '../components/target/ActionColumn'
import { PendingVoteProvider, type Signal } from '../components/target/pendingVote'
import { SignalBreakdown } from '../components/target/SignalBreakdown'
import { copy } from '../lib/copy'
import { address, CORE, scan, targetId, txHash, word } from './attest.fixtures'

const group = (caution: number): SignalGroup => ({
  votes: { safe: 0, caution, danger: 0 },
  weight: { safe: 0, caution, danger: 0 },
  flags: 0,
})
const signal = (caution: number): Signal => ({ newIds: group(caution), guardians: group(0) })

function page(current: Signal) {
  return (
    <PendingVoteProvider signal={current}>
      <SignalBreakdown signal={current} />
      <ActionColumn
        tier="CAUTION_FLAGGED"
        targetType="SMART_CONTRACT"
        currentVersionHref={null}
        targetId={targetId}
        targetWord={word}
        bundleChanged={false}
        evidenceFailed={false}
        label={address}
        scan={scan()}
        attestations={[]}
        underDispute={false}
      />
    </PendingVoteProvider>
  )
}

async function vote() {
  await userEvent.click(screen.getByRole('button', { name: copy.attest.action }))
  await userEvent.click(screen.getByRole('radio', { name: /^Caution/ }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.review }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x2000000000000000000000000000000000000002',
    core: CORE,
  })
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  wagmi.signTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  uploadEvidence.mockImplementation(async (body: { reportJson: string }) => ({
    evidenceURI: 'ipfs://bafycid',
    evidenceHash: evidenceHashOf(new TextEncoder().encode(body.reportJson)),
  }))
})

test('success shows the vote in the signal breakdown labelled "Waiting for finality"', async () => {
  render(page(signal(0)))
  const table = screen.getByRole('table', { name: copy.target.communitySignal })
  expect(within(table).queryByText(copy.common.waitingFinality)).toBeNull()
  await vote()
  const row = await within(table).findByRole('row', { name: /Your vote: Caution/ })
  expect(row).toHaveTextContent(copy.common.waitingFinality)
  expect(within(row).getByRole('link', { name: copy.target.transaction })).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
})

test('success asks the server for the page again, once', async () => {
  render(page(signal(0)))
  await vote()
  await screen.findByRole('row', { name: /Your vote: Caution/ })
  expect(refresh).toHaveBeenCalledTimes(1)
})

test('after the vote the button names the verdict and links to the transaction', async () => {
  render(page(signal(0)))
  await vote()
  const link = await screen.findByRole('link', { name: copy.attest.alreadyVerdict.replace('{verdict}', 'Caution') })
  expect(link).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
})

test('the waiting row leaves when the server data holds the vote', async () => {
  const view = render(page(signal(0)))
  await vote()
  await screen.findByRole('row', { name: /Your vote: Caution/ })
  view.rerender(page(signal(1)))
  expect(screen.queryByRole('row', { name: /Your vote: Caution/ })).toBeNull()
})

test('no vote, no refresh', () => {
  render(page(signal(0)))
  expect(refresh).not.toHaveBeenCalled()
})

test('the summary cannot be left while the wallet or the chain is still working', async () => {
  wagmi.writeContractAsync.mockReturnValue(new Promise(() => {}))
  render(page(signal(0)))
  await vote()
  expect(screen.getByRole('button', { name: copy.attest.back })).toBeDisabled()
})

test('the vote shown is the vote that was sent, even when the choice changes afterwards', async () => {
  render(page(signal(0)))
  await vote()
  await screen.findByRole('row', { name: /Your vote: Caution/ })
  await userEvent.click(screen.getByRole('button', { name: copy.attest.back }))
  await userEvent.click(screen.getByRole('radio', { name: /^Danger/ }))
  expect(screen.queryByRole('row', { name: /Your vote: Danger/ })).toBeNull()
  expect(screen.getByRole('row', { name: /Your vote: Caution/ })).toBeInTheDocument()
})

test('the wallet is read again once the receipt is good, so the quota follows the chain', async () => {
  const recheck = vi.fn()
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck, attestationsLeft: 3 }
  render(page(signal(0)))
  await vote()
  await screen.findByRole('row', { name: /Your vote: Caution/ })
  expect(recheck).toHaveBeenCalledTimes(1)
})

test('the panel cannot be closed while the vote is on its way', async () => {
  wagmi.receipt.current = { isSuccess: false, isError: false, error: null }
  render(page(signal(0)))
  await vote()
  await waitFor(() => expect(screen.getByRole('button', { name: copy.common.close })).toBeDisabled())
})
