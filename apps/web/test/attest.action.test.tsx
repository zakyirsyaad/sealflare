import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CONSTANTS } from '@sealflare/shared/rules'
import type { AttestationRow } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  switchChain: vi.fn(),
  connectors: [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
}))
vi.mock('wagmi', () => ({
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: () => ({ isSuccess: false, isError: false, error: null }),
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

vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api: { uploadEvidence: vi.fn() } }
})

import { ActionColumn } from '../components/target/ActionColumn'
import { copy } from '../lib/copy'

import { address, targetId, txHash, word } from './attest.fixtures'

function row(overrides: Partial<AttestationRow> = {}): AttestationRow {
  return {
    index: 0,
    guardian: address,
    verdict: 'SAFE',
    flags: 0,
    weight: 1,
    safeOrdinal: 1,
    shortProof: 'ok',
    evidenceURI: 'ipfs://bafycid',
    txHash,
    at: '2026-11-25T03:00:00.000Z',
    settled: true,
    castDuringDispute: false,
    ...overrides,
  }
}

function actionColumn(overrides: Partial<Parameters<typeof ActionColumn>[0]> = {}) {
  return render(
    <ActionColumn
      tier="CAUTION_FLAGGED"
      targetType="SMART_CONTRACT"
      currentVersionHref={null}
      targetId={targetId}
      targetWord={word}
      bundleChanged={false}
      evidenceFailed={false}
      label={address}
      scan={null}
      attestations={[]}
      underDispute={false}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
})

test('already attested: the button names the verdict and links to the transaction', () => {
  actionColumn({ attestations: [row({ verdict: 'SAFE' })] })
  const link = screen.getByRole('link', { name: copy.attest.alreadyVerdict.replace('{verdict}', 'Safe') })
  expect(link).toHaveAttribute('href', `https://bscscan.com/tx/${txHash}`)
})

test('quota used up: the button is disabled and says when the quota returns', () => {
  state.value = { kind: 'holder', address, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 0 }
  actionColumn()
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeDisabled()
  expect(screen.getByText(new RegExp(`You have used all ${CONSTANTS.DAILY_ATTEST_LIMIT} attestations for today\\.`))).toBeInTheDocument()
  expect(screen.getByText(/The quota returns at .* UTC\./)).toBeInTheDocument()
})

test('no wallet: the button opens the panel, which asks to connect', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  actionColumn()
  const button = screen.getByRole('button', { name: copy.attest.action })
  expect(button).toBeEnabled()
  await userEvent.click(button)
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
})

test('contract code changed: attesting is closed with the explanation', () => {
  actionColumn({ tier: 'STALE_CODEHASH_DRIFT' })
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeDisabled()
  expect(screen.getByText(copy.errors.CodeChangedSincePin)).toBeInTheDocument()
})

test('skill changed: the button reads "Scan the current version"', () => {
  actionColumn({ targetType: 'AI_SKILL_BUNDLE', bundleChanged: true })
  expect(screen.queryByRole('button', { name: copy.attest.action })).toBeNull()
  expect(screen.getByRole('button', { name: copy.target.currentVersion })).toBeDisabled()
})

test('skill changed with a link to the current version: the button is a link', () => {
  actionColumn({ targetType: 'AI_SKILL_BUNDLE', bundleChanged: true, currentVersionHref: '/app/scan?src=gh:a/b' })
  expect(screen.getByRole('link', { name: copy.target.currentVersion })).toHaveAttribute('href', '/app/scan?src=gh:a/b')
})

test('a skill with the same bundle can be attested', () => {
  actionColumn({ targetType: 'AI_SKILL_BUNDLE', bundleChanged: false })
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeEnabled()
})

test('without a wallet a drifted contract still asks to connect first', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  actionColumn({ tier: 'STALE_CODEHASH_DRIFT' })
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeEnabled()
  expect(screen.queryByText(copy.errors.CodeChangedSincePin)).toBeNull()
})

test('already attested without a known transaction: the verdict is shown without a link', () => {
  actionColumn({ attestations: [row({ txHash: `0x${'0'.repeat(64)}` })], evidenceFailed: true })
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByRole('button', { name: copy.attest.alreadyVerdict.replace('{verdict}', 'Safe') })).toBeDisabled()
})

test('already attested while the event log could not be read: no link to a transaction that may not exist', () => {
  actionColumn({ attestations: [row()], evidenceFailed: true })
  expect(screen.queryByRole('link')).toBeNull()
})
