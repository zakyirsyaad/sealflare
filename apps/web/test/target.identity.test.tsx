import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { TargetScreen, type TargetScreenProps } from '../components/target/TargetScreen'
import { copy } from '../lib/copy'

type WalletState = { kind: string; isLoading: boolean; isError: boolean; recheck: () => void; attestationsLeft?: number }

const { wallet } = vi.hoisted(() => ({
  wallet: { current: { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} } as WalletState },
}))

vi.mock('../lib/chain/userState', () => ({ useUserState: () => wallet.current }))
vi.mock('../lib/sandbox/useSandboxRun', () => ({
  useSandboxRun: () => ({ run: null, busy: false, error: null, paused: false, start: vi.fn() }),
}))

const publisher = `0x${'44'.repeat(20)}` as const
const contentHash = `0x${'33'.repeat(32)}` as const
const bundle = canonicalBundleHash(contentHash, publisher)
const targetId = targetIdOfSkill(bundle)

beforeEach(() => {
  wallet.current = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
})

function skillDetail(): TargetDetail {
  return TargetDetail.parse({
    targetId,
    targetType: 'AI_SKILL_BUNDLE',
    label: 'sealflare/guard',
    src: 'gh:sealflare/guard@' + 'a'.repeat(40) + ':skills/guard',
    tier: 'CAUTION_FLAGGED',
    safe: 0,
    caution: 0,
    danger: 2,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-20T10:00:00.000Z',
    publisher: null,
    pinnedCodehash: bundle,
    hasDelegatecall: false,
    activeFlags: 0,
    signal: {
      newIds: { votes: { safe: 0, caution: 0, danger: 0 }, weight: { safe: 0, caution: 0, danger: 0 }, flags: 0 },
      guardians: { votes: { safe: 0, caution: 0, danger: 0 }, weight: { safe: 0, caution: 0, danger: 0 }, flags: 0 },
    },
    activeChallengeId: null,
    attestationCount: 0,
    scan: null,
    sandbox: null,
  })
}

function skillScan(): ScanReport {
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId,
    source: {
      kind: 'skill',
      repo: 'sealflare/guard',
      commit: 'a'.repeat(40),
      path: 'skills/guard',
      contentHash,
      manifestPublisher: publisher,
      canonicalBundleHash: bundle,
      fileCount: 3,
      totalBytes: 2048,
    },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [{ id: 'bundle_hash', status: 'passed' }],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  })
}

function props(overrides: Partial<TargetScreenProps> = {}): TargetScreenProps {
  return {
    targetId,
    detail: skillDetail(),
    attestations: [],
    scan: skillScan(),
    src: 'gh:sealflare/guard@' + 'a'.repeat(40) + ':skills/guard',
    blocksBehind: null,
    unbondingAt: null,
    differentBundle: false,
    evidenceFailed: false,
    failed: false,
    ...overrides,
  }
}

test('the copy button of a skill copies the link of the repository, not the bare name', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  render(<TargetScreen {...props()} />)
  await userEvent.click(screen.getByRole('button', { name: copy.target.copyLink }))
  expect(writeText).toHaveBeenCalledWith('https://github.com/sealflare/guard')
  vi.unstubAllGlobals()
})

test('the reason for a closed attest button names the chain and never shows a placeholder', () => {
  wallet.current = { kind: 'wrong-network', isLoading: false, isError: false, recheck: () => {} }
  render(<TargetScreen {...props()} />)
  expect(screen.getByText('Switch to BNB Smart Chain')).toBeInTheDocument()
  expect(screen.queryByText(/\{chain\}/)).toBeNull()
})
