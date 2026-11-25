import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { targetIdOfContract } from '@sealflare/shared/rules'
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

const address = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const targetId = targetIdOfContract(address)
const txHash = `0x${'ab'.repeat(32)}` as const

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
  expect(screen.getByText(/You have used all 5 attestations for today\./)).toBeInTheDocument()
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
  actionColumn({ tier: 'STALE_CODEHASH_DRIFT', targetType: 'AI_SKILL_BUNDLE' })
  expect(screen.queryByRole('button', { name: copy.attest.action })).toBeNull()
  expect(screen.getByRole('button', { name: copy.target.currentVersion })).toBeDisabled()
})
