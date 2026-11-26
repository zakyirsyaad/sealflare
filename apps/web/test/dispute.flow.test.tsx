import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { UserRejectedRequestError } from 'viem'
import { CONSTANTS, FLAGS, FLAG_NAMES, SKILL_FLAGS_MASK } from '@sealflare/shared/rules'
import { EvidenceReport, evidenceHashOf, parseShortProof } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  reads: { current: {} as Record<string, unknown> },
  receipt: { current: { isSuccess: false, isError: false, error: null as unknown } },
}))
vi.mock('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: () => wagmi.receipt.current,
  useReadContract: (params: { functionName: string }) => ({
    data: wagmi.reads.current[params.functionName],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useConnectors: () => [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => state.value }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: true,
  agentIdUrl: 'https://agent-id.example/get',
}))

const uploadEvidence = vi.hoisted(() => vi.fn())
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api: { uploadEvidence } }
})

import { ChallengePanel } from '../components/dispute/ChallengePanel'
import { ReplyPanel } from '../components/dispute/ReplyPanel'
import { copy } from '../lib/copy'
import { COURT, CORE, ME, address, scan, targetId, txHash } from './dispute.fixtures'
import { bundle, skillId, skillScan } from './attest.fixtures'

const rejection = () => new UserRejectedRequestError(new Error('The user rejected the request.'))

function revert(errorName: string, args: unknown[] = []) {
  return Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError', data: { errorName, args } })
}

function panel(overrides: Partial<Parameters<typeof ChallengePanel>[0]> = {}) {
  return render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={() => {}} {...overrides} />,
  )
}

async function toReview(statement = 'The owner can mint without a cap.') {
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), statement)
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
}

const submit = () => userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: CORE,
    court: COURT,
  })
  state.value = { kind: 'holder', address: ME, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 5 }
  wagmi.reads.current = { nextExpireForfeitBps: 2000 }
  wagmi.receipt.current = { isSuccess: false, isError: false, error: null }
  wagmi.signTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  uploadEvidence.mockImplementation(async (body: { reportJson: string }) => ({
    evidenceURI: 'ipfs://bafycid',
    evidenceHash: evidenceHashOf(new TextEncoder().encode(body.reportJson)),
  }))
})

// ---- opening a challenge -------------------------------------------------------------------

test('the evidence is signed first, then uploaded, and only then is the transaction asked for', async () => {
  panel()
  await toReview()
  await submit()
  const sign = wagmi.signTypedDataAsync.mock.invocationCallOrder[0]!
  const upload = uploadEvidence.mock.invocationCallOrder[0]!
  const write = wagmi.writeContractAsync.mock.invocationCallOrder[0]!
  expect(sign).toBeLessThan(upload)
  expect(upload).toBeLessThan(write)
})

test('the bytes signed, uploaded and hashed on-chain are the same report, written as a challenge by this wallet', async () => {
  panel()
  await toReview('The owner can mint without a cap.')
  await submit()
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string; address: string }
  const bytes = new TextEncoder().encode(sent.reportJson)
  const signed = wagmi.signTypedDataAsync.mock.calls[0]?.[0] as { message: { evidenceHash: string }; account: string }
  expect(signed.message.evidenceHash).toBe(evidenceHashOf(bytes))
  expect(signed.account).toBe(ME)
  expect(sent.address).toBe(ME)
  const report = EvidenceReport.parse(JSON.parse(sent.reportJson))
  expect(report.kind).toBe('challenge')
  expect(report.author).toBe(ME)
  expect(report.targetId).toBe(targetId)
  expect(report.flags).toBe(FLAGS.UNVERIFIED_SOURCE)
  expect(report.statement).toBe('The owner can mint without a cap.')
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }
  expect(written.args[2]).toBe(evidenceHashOf(bytes))
  expect(written.args[3]).toMatch(/^0x[0-9a-f]+$/)
})

test('rejecting the first approval returns to the review step with no error and no upload', async () => {
  wagmi.signTypedDataAsync.mockRejectedValue(rejection())
  panel()
  await toReview()
  await submit()
  expect(screen.getByRole('heading', { name: copy.dispute.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.dispute.submit })).toBeEnabled()
  expect(uploadEvidence).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('rejecting the transaction after the upload returns to the review step with no error and nothing on-chain', async () => {
  wagmi.writeContractAsync.mockRejectedValue(rejection())
  panel()
  await toReview()
  await submit()
  expect(screen.getByRole('heading', { name: copy.dispute.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.dispute.submit })).toBeEnabled()
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
})

test('a failed upload shows the message and no transaction is requested', async () => {
  uploadEvidence.mockRejectedValue(new Error('the storage is down'))
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText(copy.attest.uploadFailed)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('an evidence answer with another hash stops before the transaction', async () => {
  uploadEvidence.mockResolvedValue({ evidenceURI: 'ipfs://bafycid', evidenceHash: `0x${'00'.repeat(32)}` })
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText(copy.attest.hashMismatch)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a revert names its reason and offers a retry that signs again', async () => {
  wagmi.writeContractAsync.mockRejectedValueOnce(revert('ChallengeAlreadyActive', [12n]))
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText('A challenge is already open for this target (number 12).')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  expect(wagmi.signTypedDataAsync).toHaveBeenCalledTimes(2)
})

test('a transaction that is reverted after it was sent shows the reason of the contract and keeps the link', async () => {
  wagmi.receipt.current = { isSuccess: false, isError: true, error: revert('WrongPhase', [2]) }
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText('This action is not available right now (reveal phase).')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
})

test('a transaction that is confirmed says it waits for finality and links the transaction', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
})

test('a flag the scanner did not find asks for a short quote before the evidence step is complete', async () => {
  panel()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Hidden mint' }))
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  const quote = screen.getByLabelText('Quote from the evidence for Hidden mint')
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), 'The owner can mint.')
  expect(screen.getByRole('button', { name: copy.dispute.continue })).toBeDisabled()
  await userEvent.type(quote, 'function mint(address to)')
  expect(screen.getByRole('button', { name: copy.dispute.continue })).toBeEnabled()
  expect(screen.getByText(/of 512 bytes/)).toBeInTheDocument()
  const preview = screen.getByText(/HIDDEN_MINT @ user report: function mint\(address to\)/)
  expect(parseShortProof(preview.textContent ?? '').map(item => item.flag)).toContain('HIDDEN_MINT')
})

test('the written explanation is required', async () => {
  panel()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  expect(screen.getByRole('button', { name: copy.dispute.continue })).toBeDisabled()
  expect(screen.getByText(copy.dispute.statementRequired)).toBeInTheDocument()
})

test('a contract is only offered the flags of a contract, and a skill only the flags of a skill', () => {
  const first = panel()
  expect(screen.getByRole('checkbox', { name: 'Hidden mint' })).toBeInTheDocument()
  first.unmount()
  panel({ targetId: skillId, targetType: 'AI_SKILL_BUNDLE', label: 'sealflare/guard', scan: skillScan() })
  expect(screen.queryByRole('checkbox', { name: 'Hidden mint' })).toBeNull()
  const skillFlags = FLAG_NAMES.filter(name => (FLAGS[name] & SKILL_FLAGS_MASK) !== 0)
  expect(screen.getAllByRole('checkbox')).toHaveLength(skillFlags.length)
  expect(bundle).toBeDefined()
})

test('without a Court address nothing is signed', async () => {
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: CORE,
  })
  panel()
  await toReview()
  await submit()
  expect(await screen.findByText(copy.dispute.noCourt)).toBeInTheDocument()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('without a wallet, on the wrong network or without an Agent ID the panel shows that branch and no steps', () => {
  state.value = { kind: 'no-agent-id', address: ME, isLoading: false, isError: false, recheck: () => {} }
  const first = panel()
  expect(screen.getByText(copy.wallet.agentRequired)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.dispute.continue })).toBeNull()
  first.unmount()
  state.value = { kind: 'wrong-network', isLoading: false, isError: false, recheck: () => {} }
  panel()
  expect(screen.getByRole('button', { name: /^Switch to/ })).toBeInTheDocument()
})

test('two attempts never share a nonce and never live longer than ten minutes', async () => {
  const first = panel()
  await toReview()
  await submit()
  first.unmount()
  panel()
  await toReview()
  await submit()
  const one = uploadEvidence.mock.calls[0]?.[0] as { nonce: string; expiry: string }
  const two = uploadEvidence.mock.calls[1]?.[0] as { nonce: string; expiry: string }
  expect(one.nonce).not.toBe(two.nonce)
  const now = Math.floor(Date.now() / 1000)
  expect(Number(one.expiry) - now).toBeLessThanOrEqual(600)
  expect(Number(one.expiry) - now).toBeGreaterThan(0)
})

test('the stake sent is the constant of the contract even after a retry', async () => {
  wagmi.writeContractAsync.mockRejectedValueOnce(revert('InvalidFlags'))
  panel()
  await toReview()
  await submit()
  await userEvent.click(await screen.findByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  for (const call of wagmi.writeContractAsync.mock.calls) {
    expect((call[0] as { value: bigint }).value).toBe(CONSTANTS.CHALLENGE_STAKE)
  }
})

// ---- the reply of the publisher ------------------------------------------------------------

function reply() {
  return render(<ReplyPanel challengeId="12" targetId={targetId} onClose={() => {}} />)
}

async function writeReply(text = 'The mint is capped by the governor.') {
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), text)
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.replySubmit }))
}

test('the reply is signed, uploaded and then written to the Court as counter evidence', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  reply()
  await writeReply()
  const sign = wagmi.signTypedDataAsync.mock.invocationCallOrder[0]!
  const upload = uploadEvidence.mock.invocationCallOrder[0]!
  const write = wagmi.writeContractAsync.mock.invocationCallOrder[0]!
  expect(sign).toBeLessThan(upload)
  expect(upload).toBeLessThan(write)
  expect(wagmi.writeContractAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      functionName: 'submitCounterEvidence',
      address: COURT,
      account: ME,
      chainId: 56,
      args: [12n, 'ipfs://bafycid'],
    }),
  )
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  const report = EvidenceReport.parse(JSON.parse(sent.reportJson))
  expect(report.kind).toBe('counter')
  expect(report.author).toBe(ME)
  expect(report.targetId).toBe(targetId)
  expect(report.statement).toBe('The mint is capped by the governor.')
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
})

test('the reply needs text before it can be signed', () => {
  reply()
  expect(screen.getByRole('button', { name: copy.dispute.replySubmit })).toBeDisabled()
})

test('rejecting the transaction of the reply returns to the summary with no error', async () => {
  wagmi.writeContractAsync.mockRejectedValue(rejection())
  reply()
  await writeReply()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.dispute.replySubmit })).toBeEnabled()
})

test('a failed upload of the reply requests no transaction', async () => {
  uploadEvidence.mockRejectedValue(new Error('down'))
  reply()
  await writeReply()
  expect(await screen.findByText(copy.attest.uploadFailed)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a reply from a wallet that is not the publisher shows the reason of the contract', async () => {
  wagmi.writeContractAsync.mockRejectedValue(revert('NotPublisher'))
  reply()
  await writeReply()
  expect(await screen.findByText(copy.errors.NotPublisher)).toBeInTheDocument()
})

// ---- review round 1 ------------------------------------------------------------------------

test('a transaction that was mined but reverted is a failure, never "Waiting for finality"', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null, data: { status: 'reverted' } } as never
  panel()
  await toReview()
  await submit()
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.unknown)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
  expect(screen.getByRole('button', { name: copy.common.retry })).toBeInTheDocument()
})

test('a reply that was mined but reverted is a failure too', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null, data: { status: 'reverted' } } as never
  reply()
  await writeReply()
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.unknown)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
})

test('a scan of another target ticks nothing and is never attached to the report', async () => {
  // The scan holds a flag, but it is the scan of another target, so it must not speak for this one.
  const foreign = { ...scan(), targetId: skillId }
  panel({ scan: foreign })
  expect(foreign.flags).toBe(FLAGS.UNVERIFIED_SOURCE)
  expect(screen.getByRole('checkbox', { name: 'Unverified source' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: copy.dispute.continue })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Hidden mint' }))
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  await userEvent.type(screen.getByLabelText('Quote from the evidence for Hidden mint'), 'function mint(address to)')
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), 'The owner can mint.')
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  await submit()
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  expect(JSON.parse(sent.reportJson).scan).toBeUndefined()
})
