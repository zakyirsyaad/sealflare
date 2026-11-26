import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserRejectedRequestError } from 'viem'
import { EVIDENCE_MAX_BYTES, evidenceHashOf, utf8Length } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  switchChain: vi.fn(),
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
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api: { uploadEvidence } }
})

import { AttestPanel } from '../components/attest/AttestPanel'
import { copy } from '../lib/copy'
import { address, bundle, cleanScan, contractScan, CORE, scan, skillId, skillScan, targetId, twoFindingScan, txHash, unverified, word } from './attest.fixtures'

function panelProps(overrides: Partial<Parameters<typeof AttestPanel>[0]> = {}): Parameters<typeof AttestPanel>[0] {
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

test('a Safe vote offers no flag at all', async () => {
  panel()
  await userEvent.click(radio('Safe'))
  expect(screen.queryByRole('button', { name: copy.attest.addFlag })).toBeNull()
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

test('Core.attest takes the word of the contract, never its id', async () => {
  panel()
  await toReview('Caution')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }
  expect(written.args[1]).toBe(word)
  expect(written.args[1]).not.toBe(targetId)
})

test('Core.attest takes the canonical bundle hash of a skill, never its id', async () => {
  panel({ targetId: skillId, targetWord: bundle, targetType: 'AI_SKILL_BUNDLE', label: 'sealflare/guard', scan: skillScan() })
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }
  expect(written.args[1]).toBe(bundle)
  expect(written.args[1]).not.toBe(skillId)
})

test('a target whose word is unknown asks for no signature', async () => {
  panel({ targetWord: null })
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.attest.targetUnknown)).toBeInTheDocument()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
})

test('a word that does not hash to the id of the target asks for no signature', async () => {
  panel({ targetWord: `0x${'0'.repeat(24)}${'11'.repeat(20)}` })
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.attest.targetUnknown)).toBeInTheDocument()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a drifted contract asks for no signature even when the panel is open', async () => {
  panel({ tier: 'STALE_CODEHASH_DRIFT' })
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.errors.CodeChangedSincePin)).toBeInTheDocument()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
})

test('two attempts never use the same nonce and never live longer than ten minutes', async () => {
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const first = uploadEvidence.mock.calls[0]?.[0] as { nonce: string; expiry: string }
  expect(first.expiry).toBeDefined()
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const second = uploadEvidence.mock.calls[1]?.[0] as { nonce: string; expiry: string }
  expect(second.nonce).not.toBe(first.nonce)
  const now = Math.floor(Date.now() / 1000)
  expect(Number(first.expiry) - now).toBeLessThanOrEqual(600)
  expect(Number(first.expiry) - now).toBeGreaterThan(0)
})

test('an evidence answer with another hash stops before the transaction', async () => {
  uploadEvidence.mockResolvedValue({ evidenceURI: 'ipfs://bafycid', evidenceHash: `0x${'00'.repeat(32)}` })
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.attest.hashMismatch)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a failed upload shows the message and no transaction is requested', async () => {
  uploadEvidence.mockRejectedValue(new Error('the storage is down'))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.attest.uploadFailed)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('rejecting the first approval returns to the review step with no error', async () => {
  wagmi.signTypedDataAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(screen.getByRole('heading', { name: copy.attest.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.attest.submit })).toBeEnabled()
  expect(screen.queryByRole('link', { name: copy.target.transaction })).toBeNull()
  expect(uploadEvidence).not.toHaveBeenCalled()
})

test('rejecting the second approval returns to the review step with no error and sends nothing', async () => {
  wagmi.writeContractAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  panel()
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(screen.getByRole('heading', { name: copy.attest.review })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: copy.attest.submit })).toBeEnabled()
  expect(screen.queryByRole('link', { name: copy.target.transaction })).toBeNull()
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
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
})

test('no wallet: the panel asks to connect and then continues at step one', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  const view = panel()
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Browser wallet' }))
  expect(wagmi.connect).toHaveBeenCalledTimes(1)
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  view.rerender(<AttestPanel {...panelProps()} />)
  expect(screen.getByRole('radiogroup', { name: copy.attest.yourVerdict })).toBeInTheDocument()
})

test('wrong network: the panel offers one switch button and then continues', async () => {
  state.value = { kind: 'wrong-network', isLoading: false, isError: false, recheck: () => {} }
  const view = panel()
  await userEvent.click(screen.getByRole('button', { name: /Switch to/ }))
  expect(wagmi.switchChain).toHaveBeenCalledTimes(1)
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  view.rerender(<AttestPanel {...panelProps()} />)
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

test('a scanner flag that will not travel with the report waits for a quote of the Guardian', async () => {
  panel({ scan: twoFindingScan() })
  await userEvent.click(radio('Caution'))
  await userEvent.click(screen.getByRole('button', { name: 'Remove Hidden mint' }))
  // The scan cannot travel with the report now, so the flag that stays needs a quote.
  expect(screen.getByText('Quote from the evidence for Unverified source')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.attest.review })).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox'), 'the owner can mint')
  expect(screen.getByRole('button', { name: copy.attest.review })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: copy.attest.review }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  expect(sent.reportJson).toContain('the owner can mint')
  expect(sent.reportJson).not.toContain('the contract is not verified on the explorer')
})

test('a target id that is not a bytes32 asks for no signature', async () => {
  panel({ targetId: '0x1234' })
  await toReview('Safe')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  expect(await screen.findByText(copy.attest.targetUnknown)).toBeInTheDocument()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('confirmed danger: Safe is disabled, Caution and Danger remain', () => {
  panel({ tier: 'CONFIRMED_DANGER' })
  expect(radio('Safe')).toBeDisabled()
  expect(radio('Caution')).toBeEnabled()
  expect(radio('Danger')).toBeEnabled()
})

test('the radiogroup holds only radios, and the note about confirmed danger describes it', () => {
  panel({ tier: 'CONFIRMED_DANGER' })
  const group = screen.getByRole('radiogroup', { name: copy.attest.yourVerdict })
  expect(within(group).queryByText(copy.attest.dangerSafe)).toBeNull()
  const note = screen.getByText(copy.attest.dangerSafe)
  expect(group).toHaveAttribute('aria-describedby', note.id)
})

test('the arrow keys move the choice and do not scroll the page', async () => {
  panel()
  await userEvent.click(radio('Caution'))
  const notPrevented = fireEvent.keyDown(radio('Caution'), { key: 'ArrowDown' })
  expect(notPrevented).toBe(false)
  expect(radio('Danger')).toHaveAttribute('aria-checked', 'true')
})

test('both approvals name the connected account, and the write names the chain', async () => {
  panel()
  await toReview('Caution')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1))
  expect(wagmi.signTypedDataAsync.mock.calls[0]?.[0]).toMatchObject({ account: address })
  expect(wagmi.writeContractAsync.mock.calls[0]?.[0]).toMatchObject({ account: address, chainId: 56 })
})

test('a scan with a finding for every match is trimmed to one per flag before it is signed', async () => {
  const many = Array.from({ length: 330 }, (_, index) => ({
    ...unverified,
    title: `match ${index} ${'t'.repeat(100)}`,
    location: 'l'.repeat(200),
    excerpt: 'e'.repeat(500),
  }))
  const big = contractScan(many)
  expect(utf8Length(JSON.stringify(big))).toBeGreaterThan(EVIDENCE_MAX_BYTES)
  panel({ scan: big })
  await toReview('Caution')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1))
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  expect(utf8Length(sent.reportJson)).toBeLessThanOrEqual(EVIDENCE_MAX_BYTES)
  const report = JSON.parse(sent.reportJson) as { scan: { findings: unknown[]; flags: number } }
  expect(report.scan.findings).toHaveLength(1)
  expect(report.scan.flags).toBe(big.flags)
})

test('the full quote of the Guardian is kept in the report when the short proof has to cut it', async () => {
  panel()
  await userEvent.click(radio('Caution'))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.addFlag }))
  await userEvent.click(screen.getByRole('button', { name: 'Hidden mint' }))
  const quote = `function mint(address to) ${'x'.repeat(700)}`
  await userEvent.click(screen.getByRole('textbox'))
  await userEvent.paste(quote)
  await userEvent.click(screen.getByRole('button', { name: copy.attest.review }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1))
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  const report = JSON.parse(sent.reportJson) as { statement?: string; shortProof: string }
  expect(report.statement).toContain(quote)
  expect(report.shortProof).not.toContain(quote)
})

test('a report with no quote of the Guardian carries no statement', async () => {
  panel()
  await toReview('Caution')
  await userEvent.click(screen.getByRole('button', { name: copy.attest.submit }))
  await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1))
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  expect(JSON.parse(sent.reportJson)).not.toHaveProperty('statement')
})

test('the summary names the flags in sentence case, like the step before', async () => {
  panel()
  await toReview('Caution')
  expect(screen.getByText('Unverified source')).toBeInTheDocument()
  expect(screen.queryByText(/UNVERIFIED_SOURCE/)).toBeNull()
})

test('a Safe vote promises no fixed reward, because the reward row gives the schedule by slot', async () => {
  panel()
  await toReview('Safe')
  expect(screen.queryByText(/would earn \+2/)).toBeNull()
  expect(screen.getByText(/\+2 XP for the first three slots/)).toBeInTheDocument()
})
