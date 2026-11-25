import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserRejectedRequestError } from 'viem'
import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { evidenceHashOf, ScanReport } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  switchChain: vi.fn(),
  connectors: [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
  receipt: { current: { isSuccess: false, isError: false, error: null as unknown } },
}))
vi.mock('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: () => wagmi.receipt.current,
  useConnect: () => ({ mutate: wagmi.connect, isPending: false, error: null }),
  useConnectors: () => wagmi.connectors,
  useDisconnect: () => ({ mutate: wagmi.disconnect }),
  useSwitchChain: () => ({ mutate: wagmi.switchChain, isPending: false, error: null }),
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
vi.mock('../lib/api/client', () => ({ api: { uploadEvidence } }))

import { AttestPanel } from '../components/attest/AttestPanel'
import { copy } from '../lib/copy'

const address = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const targetId = targetIdOfContract(address)
const codehash = `0x${'22'.repeat(32)}` as const
const txHash = `0x${'ab'.repeat(32)}` as const
const CORE = '0x1000000000000000000000000000000000000001'

function scan(overrides: Record<string, unknown> = {}) {
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'SMART_CONTRACT',
    targetId,
    source: { kind: 'contract', address, codehash, blockNumber: '52000000' },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [
      { id: 'source_verified', status: 'flagged' },
      { id: 'admin_functions', status: 'passed' },
      { id: 'proxy_eip1967', status: 'passed' },
      { id: 'proxy_beacon', status: 'passed' },
      { id: 'proxy_eip1167', status: 'passed' },
      { id: 'delegatecall_opcode', status: 'passed' },
      { id: 'dry_run', status: 'passed' },
    ],
    findings: [
      {
        flag: 'UNVERIFIED_SOURCE',
        checkId: 'source_verified',
        title: 'The source is not verified',
        location: 'explorer',
        excerpt: 'the contract is not verified on the explorer',
      },
    ],
    flags: FLAGS.UNVERIFIED_SOURCE,
    suggestedVerdict: 'CAUTION',
    ...overrides,
  })
}

/** A scan that found nothing, so every check passed. */
function cleanScan() {
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'SMART_CONTRACT',
    targetId,
    source: { kind: 'contract', address, codehash, blockNumber: '52000000' },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [
      { id: 'source_verified', status: 'passed' },
      { id: 'admin_functions', status: 'passed' },
      { id: 'proxy_eip1967', status: 'passed' },
      { id: 'proxy_beacon', status: 'passed' },
      { id: 'proxy_eip1167', status: 'passed' },
      { id: 'delegatecall_opcode', status: 'passed' },
      { id: 'dry_run', status: 'passed' },
    ],
    findings: [],
    flags: 0,
    suggestedVerdict: 'SAFE',
  })
}

function panel(overrides: Partial<Parameters<typeof AttestPanel>[0]> = {}) {
  return render(
    <AttestPanel
      targetId={targetId}
      targetType="SMART_CONTRACT"
      label={address}
      tier="CAUTION_FLAGGED"
      scan={scan()}
      attestations={[]}
      underDispute={false}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

/** Chooses a verdict and moves to the review step. */
/** The verdict buttons. The name starts with the verdict, so the help text never matches. */
function radio(name: 'Safe' | 'Caution' | 'Danger') {
  return screen.getByRole('radio', { name: new RegExp(`^${name}`) })
}

async function toReview(verdict: 'Safe' | 'Caution' | 'Danger' = 'Safe') {
  await userEvent.click(radio(verdict))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.review }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x2000000000000000000000000000000000000002',
    core: CORE,
  })
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  wagmi.receipt.current = { isSuccess: false, isError: false, error: null }
  wagmi.signTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  uploadEvidence.mockResolvedValue({ evidenceURI: 'ipfs://bafycid', evidenceHash: `0x${'00'.repeat(32)}` })
})

test('the scanner suggestion is shown but no verdict is preselected', () => {
  panel()
  expect(screen.getByText(/The scanner suggests Caution/)).toBeInTheDocument()
  expect(radio('Caution')).toHaveAttribute('aria-checked', 'false')
  expect(radio('Safe')).toHaveAttribute('aria-checked', 'false')
  expect(radio('Danger')).toHaveAttribute('aria-checked', 'false')
})

test('the review step shows what is written on-chain and both fixed sentences', async () => {
  panel()
  await toReview('Safe')
  expect(screen.getByText(copy.attest.onChain)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.rowTarget)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.rowEvidence)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.rowBnb)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.permanent)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.claimable)).toBeInTheDocument()
})

const rewards: [('Safe' | 'Caution' | 'Danger'), string, string][] = [
  ['Safe', '+2 XP', '-15'],
  ['Caution', '0 XP', 'none'],
  ['Danger', '+5 XP', 'none'],
]

test.each(rewards)('%s shows reward %s and risk %s', async (verdict, reward, risk) => {
  panel()
  await toReview(verdict)
  expect(screen.getByText(new RegExp(reward.replace('+', '\\+')))).toBeInTheDocument()
  expect(screen.getByText(risk)).toBeInTheDocument()
})

test('the panel says up front there are two approvals and only the second uses gas', async () => {
  panel()
  expect(screen.getByText(copy.attest.twoApprovals)).toBeInTheDocument()
  await toReview('Safe')
  expect(screen.getByText(copy.attest.noGas)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.gas)).toBeInTheDocument()
})

test('choosing Safe clears the flags', async () => {
  panel()
  await userEvent.click(radio('Caution'))
  expect(screen.getByText('Unverified source')).toBeInTheDocument()
  await userEvent.click(radio('Safe'))
  expect(screen.queryByText('Unverified source')).toBeNull()
})

test('Caution and Danger need at least one flag', async () => {
  panel({ scan: cleanScan() })
  await userEvent.click(radio('Caution'))
  expect(screen.getByText(copy.attest.needFlag)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.attest.review })).toBeDisabled()
})

test('a flag the scanner did not find asks for a short evidence quote', async () => {
  panel()
  await userEvent.click(radio('Caution'))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.addFlag }))
  await userEvent.click(screen.getByRole('button', { name: 'Hidden mint' }))
  expect(screen.getByText('Quote from the evidence for Hidden mint')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.attest.review })).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox'), 'the owner can mint')
  expect(screen.getByRole('button', { name: copy.attest.review })).toBeEnabled()
})

test('the bytes signed, uploaded and hashed are the same reportJson', async () => {
  panel()
  await toReview('Caution')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  const signed = wagmi.signTypedDataAsync.mock.calls[0]?.[0] as { message: { evidenceHash: string } }
  const bytes = new TextEncoder().encode(sent.reportJson)
  expect(signed.message.evidenceHash).toBe(evidenceHashOf(bytes))
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }
  expect(written.args[4]).toBe(evidenceHashOf(bytes))
})

test('a failed upload shows the message and no transaction is requested', async () => {
  uploadEvidence.mockRejectedValue(new Error('the storage is down'))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(screen.getByText(copy.attest.uploadFailed)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('rejecting the first approval returns to the review step with no error', async () => {
  wagmi.signTypedDataAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(screen.getByRole('heading', { name: copy.attest.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(uploadEvidence).not.toHaveBeenCalled()
})

test('rejecting the second approval returns to the review step with no error and sends nothing', async () => {
  wagmi.writeContractAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(screen.getByRole('heading', { name: copy.attest.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(uploadEvidence).toHaveBeenCalledTimes(1)
  expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1)
})

test('a pending transaction locks the button and links to the transaction', async () => {
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByRole('button', { name: copy.attest.pending })).toBeDisabled()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute(
    'href',
    `https://bscscan.com/tx/${txHash}`,
  )
})

test('a revert shows the translated contract error and a retry', async () => {
  wagmi.receipt.current = {
    isSuccess: false,
    isError: true,
    error: { name: 'ContractFunctionRevertedError', data: { errorName: 'AlreadyAttested', args: [] } },
  }
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.AlreadyAttested)
  expect(screen.getByRole('button', { name: copy.common.retry })).toBeInTheDocument()
})

test('success shows the vote with the label "Waiting for finality"', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute(
    'href',
    `https://bscscan.com/tx/${txHash}`,
  )
})

test('no wallet: the panel asks to connect and then continues at step one', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  const view = panel()
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Browser wallet' }))
  expect(wagmi.connect).toHaveBeenCalledTimes(1)
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  view.rerender(
    <AttestPanel
      targetId={targetId}
      targetType="SMART_CONTRACT"
      label={address}
      tier="CAUTION_FLAGGED"
      scan={scan()}
      attestations={[]}
      underDispute={false}
      onClose={() => {}}
    />,
  )
  expect(screen.getByRole('radiogroup', { name: copy.attest.yourVerdict })).toBeInTheDocument()
})

test('wrong network: the panel offers one switch button and then continues', async () => {
  state.value = { kind: 'wrong-network', isLoading: false, isError: false, recheck: () => {} }
  const view = panel()
  await userEvent.click(screen.getByRole('button', { name: /Switch to/ }))
  expect(wagmi.switchChain).toHaveBeenCalledTimes(1)
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  view.rerender(
    <AttestPanel
      targetId={targetId}
      targetType="SMART_CONTRACT"
      label={address}
      tier="CAUTION_FLAGGED"
      scan={scan()}
      attestations={[]}
      underDispute={false}
      onClose={() => {}}
    />,
  )
  expect(screen.getByRole('radiogroup', { name: copy.attest.yourVerdict })).toBeInTheDocument()
})

test('no Agent ID: the panel shows the two paths and Check again', async () => {
  const recheck = vi.fn()
  state.value = { kind: 'no-agent-id', address, isLoading: false, isError: false, recheck }
  panel()
  expect(screen.getByText(copy.wallet.otherWallet)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.wallet.getAgentId })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.wallet.checkAgain }))
  expect(recheck).toHaveBeenCalledTimes(1)
})

test('target under dispute: attesting is allowed and both notes are shown', async () => {
  panel({ underDispute: true })
  await toReview('Safe')
  expect(screen.getByText(copy.attest.disputeNoteXp)).toBeInTheDocument()
  expect(screen.getByText(copy.attest.disputeNoteJury)).toBeInTheDocument()
})

test('confirmed danger: Safe is disabled, Caution and Danger remain', () => {
  panel({ tier: 'CONFIRMED_DANGER' })
  expect(radio('Safe')).toBeDisabled()
  expect(radio('Caution')).toBeEnabled()
  expect(radio('Danger')).toBeEnabled()
})
