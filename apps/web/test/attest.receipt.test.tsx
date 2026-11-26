import { beforeEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { evidenceHashOf } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  connectors: [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
  receipt: { current: { isSuccess: false, isError: false, error: null as unknown } },
  receiptParams: [] as { hash?: string; chainId?: number; onReplaced?: (replacement: { reason: string }) => void }[],
}))
vi.mock('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: (params: {
    hash?: string
    chainId?: number
    onReplaced?: (replacement: { reason: string }) => void
  }) => {
    wagmi.receiptParams.push(params)
    return wagmi.receipt.current
  },
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useConnectors: () => wagmi.connectors,
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))

const state = vi.hoisted(() => ({ value: { kind: 'holder', isLoading: false, isError: false, recheck: () => {} } as Record<string, unknown> }))
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

import { AttestPanel } from '../components/attest/AttestPanel'
import { copy } from '../lib/copy'
import { address, CORE, scan, targetId, txHash, word } from './attest.fixtures'

type PanelProps = Parameters<typeof AttestPanel>[0]

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    targetId,
    targetWord: word,
    targetType: 'SMART_CONTRACT',
    label: address,
    tier: 'CAUTION_FLAGGED',
    scan: scan(),
    underDispute: false,
    onClose: () => {},
    ...overrides,
  }
}

function panel(overrides: Partial<Parameters<typeof AttestPanel>[0]> = {}) {
  return render(<AttestPanel {...panelProps(overrides)} />)
}

async function toReview() {
  await userEvent.click(screen.getByRole('radio', { name: /^Safe/ }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.review }))
}

const submit = () => userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))

beforeEach(() => {
  vi.clearAllMocks()
  wagmi.receiptParams.length = 0
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x2000000000000000000000000000000000000002',
    core: CORE,
  })
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  wagmi.receipt.current = { isSuccess: false, isError: false, error: null }
  wagmi.signTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  uploadEvidence.mockImplementation(async (body: { reportJson: string }) => ({
    evidenceURI: 'ipfs://bafycid',
    evidenceHash: evidenceHashOf(new TextEncoder().encode(body.reportJson)),
  }))
})

// ---- the receipt of the vote -----------------------------------------------------------------

test('the receipt of the vote is waited for on the chain the vote was sent on', async () => {
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.hash).toBe(txHash), { timeout: 5_000 })
  expect(wagmi.receiptParams.at(-1)?.chainId).toBe(56)
}), 20_000

test('a vote the wallet cancelled is a failure, never a pending vote', async () => {
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.onReplaced).toBeTypeOf('function'), { timeout: 5_000 })
  act(() => wagmi.receiptParams.at(-1)?.onReplaced?.({ reason: 'cancelled' }))
  expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(copy.errors.txReplaced)
  expect(screen.queryByRole('button', { name: copy.attest.pending })).toBeNull()
}), 20_000

test('the panel can be left while the wallet is asking', async () => {
  // A wallet prompt that never settles must not keep the panel on the screen for ever.
  wagmi.signTypedDataAsync.mockReturnValue(new Promise(() => {}))
  const closed = vi.fn()
  render(<AttestPanel {...panelProps({ onClose: closed })} />)
  await toReview()
  await submit()
  expect(screen.getByRole('button', { name: copy.common.close })).toBeEnabled()
  document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(closed).toHaveBeenCalled()
}), 20_000
