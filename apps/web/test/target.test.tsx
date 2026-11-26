import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FLAGS, canonicalBundleHash, targetIdOfContract, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanReport, TargetDetail, type AttestationRow } from '@sealflare/shared/schemas'
import { TargetScreen, type TargetScreenProps } from '../components/target/TargetScreen'
import { TargetSkeleton } from '../components/target/TargetSkeleton'
import { copy } from '../lib/copy'
import { shortAddress } from '../lib/format'

type WalletState = { kind: string; isLoading: boolean; isError: boolean; recheck: () => void; attestationsLeft?: number }

const { wallet } = vi.hoisted(() => ({
  wallet: { current: { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} } as WalletState },
}))

vi.mock('../lib/chain/userState', () => ({ useUserState: () => wallet.current }))

const address = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const targetId = targetIdOfContract(address)
const codehash = `0x${'22'.repeat(32)}` as const

beforeEach(() => {
  wallet.current = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
})

function detail(overrides: Partial<TargetDetail> = {}): TargetDetail {
  return TargetDetail.parse({
    targetId,
    targetType: 'SMART_CONTRACT',
    label: address,
    src: address,
    tier: 'CAUTION_FLAGGED',
    safe: 42,
    caution: 0,
    danger: 3,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-20T10:00:00.000Z',
    publisher: null,
    pinnedCodehash: codehash,
    hasDelegatecall: false,
    activeFlags: 0,
    signal: {
      newIds: { votes: { safe: 42, caution: 0, danger: 0 }, weight: { safe: 42, caution: 0, danger: 0 }, flags: 0 },
      guardians: { votes: { safe: 0, caution: 0, danger: 3 }, weight: { safe: 0, caution: 0, danger: 15 }, flags: FLAGS.HIDDEN_MINT },
    },
    activeChallengeId: null,
    attestationCount: 45,
    scan: null,
    sandbox: null,
    ...overrides,
  })
}

function scan(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  })
}

function row(overrides: Partial<AttestationRow> = {}): AttestationRow {
  return {
    index: 0,
    guardian: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    verdict: 'DANGER',
    flags: FLAGS.HIDDEN_MINT,
    weight: 3,
    safeOrdinal: 0,
    shortProof: 'owner can mint',
    evidenceURI: 'https://example.org/evidence/1',
    txHash: `0x${'33'.repeat(32)}`,
    at: '2026-11-20T10:00:00.000Z',
    settled: true,
    castDuringDispute: false,
    ...overrides,
  }
}

function props(overrides: Partial<TargetScreenProps> = {}): TargetScreenProps {
  return {
    targetId,
    detail: detail(),
    attestations: [],
    scan: null,
    src: null,
    blocksBehind: null,
    unbondingAt: null,
    differentBundle: false,
    evidenceFailed: false,
    targetWord: null,
    bundleChanged: false,
    failed: false,
    ...overrides,
  }
}

function flaggedDelegatecall(extra: Record<string, unknown> = {}) {
  return scan({
    checks: [
      { id: 'source_verified', status: 'passed' },
      { id: 'admin_functions', status: 'passed' },
      { id: 'proxy_eip1967', status: 'passed' },
      { id: 'proxy_beacon', status: 'passed' },
      { id: 'proxy_eip1167', status: 'passed' },
      { id: 'delegatecall_opcode', status: 'flagged' },
      { id: 'dry_run', status: 'passed' },
    ],
    suggestedVerdict: null,
    ...extra,
  })
}

const SHA = 'a'.repeat(40)
function skillDetail(overrides: Partial<TargetDetail> = {}) {
  return detail({
    targetType: 'AI_SKILL_BUNDLE',
    label: 'sealflare/guard',
    src: `gh:sealflare/guard@${SHA}:skills/guard`,
    pinnedCodehash: `0x${'77'.repeat(32)}`,
    ...overrides,
  })
}

test('shows the tier in words with one sentence of reason', () => {
  render(<TargetScreen {...props()} />)
  expect(screen.getByRole('heading', { name: 'Caution flagged' })).toBeInTheDocument()
  expect(screen.getByText(copy.tiers.CAUTION_FLAGGED.reason)).toBeInTheDocument()
})

test('the signal breakdown shows both groups with votes, weight and flags', () => {
  render(<TargetScreen {...props()} />)
  const table = screen.getByRole('table', { name: copy.target.communitySignal })
  const newIds = within(table).getByRole('row', { name: /New IDs/ })
  expect(newIds).toHaveTextContent('42')
  const guardians = within(table).getByRole('row', { name: /Guardians/ })
  expect(guardians).toHaveTextContent('3')
  expect(guardians).toHaveTextContent('combined weight 15')
  expect(guardians).toHaveTextContent('Hidden mint')
})

test('Findings opens first and lists each check with its evidence line', () => {
  render(<TargetScreen {...props({ scan: scan() })} />)
  expect(screen.getByText(copy.target.checks.source_verified)).toBeInTheDocument()
  expect(screen.getByText(copy.target.checks.dry_run)).toBeInTheDocument()
  expect(screen.queryByText(copy.target.noScan)).toBeNull()
})

test('a finding shows its excerpt and its flag', () => {
  const report = scan({
    findings: [
      {
        flag: 'HIDDEN_MINT',
        checkId: 'admin_functions',
        title: 'Owner can mint without a cap',
        location: 'mint(address,uint256)',
        excerpt: 'function mint(address to, uint256 amount) external onlyOwner',
      },
    ],
    flags: FLAGS.HIDDEN_MINT,
    suggestedVerdict: 'DANGER',
  })
  render(<TargetScreen {...props({ scan: report })} />)
  expect(screen.getByText('Owner can mint without a cap')).toBeInTheDocument()
  expect(screen.getByText(/function mint/)).toBeInTheDocument()
  expect(screen.getAllByText('Hidden mint').length).toBeGreaterThan(0)
})

test('a partial scan lists the checks that did not run', () => {
  const report = scan({
    checks: [
      { id: 'source_verified', status: 'passed' },
      { id: 'dry_run', status: 'skipped' },
    ],
    suggestedVerdict: null,
  })
  render(<TargetScreen {...props({ scan: report })} />)
  expect(screen.getByText(copy.target.states.skipped)).toBeInTheDocument()
})

test.each([
  ['Findings', copy.target.noScan],
  ['Attestations', copy.target.noAttestations],
  ['Publisher', copy.target.noPublisher],
  ['Dispute', copy.target.noDisputes],
  ['Bounty', copy.target.noBounty],
])('the empty %s tab says "%s"', async (tab, text) => {
  render(<TargetScreen {...props()} />)
  await userEvent.click(screen.getByRole('tab', { name: new RegExp(tab) }))
  expect(screen.getByText(text)).toBeInTheDocument()
})

test.each([
  ['CONFIRMED_DANGER', null, copy.target.confirmedDanger],
  ['STALE_CODEHASH_DRIFT', null, copy.target.modified],
  ['CAUTION_FLAGGED', '7', copy.target.underDispute],
])('the %s banner shows when it applies and cannot be closed', (tier, challenge, text) => {
  const { container } = render(<TargetScreen {...props({ detail: detail({ tier: tier as TargetDetail['tier'], activeChallengeId: challenge }) })} />)
  expect(container.querySelector('.sf-banner')).toHaveTextContent(text)
  expect(screen.queryByRole('button', { name: copy.common.close })).toBeNull()
})

test('the unbonding banner shows when the publisher is unbonding', () => {
  render(<TargetScreen {...props({ unbondingAt: 1798761600 })} />)
  expect(screen.getByText(copy.target.unbonding)).toBeInTheDocument()
})

test('a proxy says it cannot get a safe status from IFirewall, and offers the on-chain flag', () => {
  const report = scan({
    source: { kind: 'contract', address, codehash, blockNumber: '52000000', implementation: { standard: 'eip1967', address, codehash } },
    suggestedVerdict: null,
  })
  render(<TargetScreen {...props({ scan: report })} />)
  expect(screen.getByText(copy.target.proxyTitle)).toBeInTheDocument()
  expect(screen.getByText(copy.target.proxyTextUnmarked)).toBeInTheDocument()
  expect(screen.queryByText(copy.target.proxyText)).toBeNull()
  // A recognised proxy is not marked on chain yet, so the on-chain flag is still offered.
  expect(screen.getByRole('button', { name: copy.target.flagProxy })).toBeInTheDocument()
})

test('before the on-chain marker is set the page does not claim the firewall never rates the proxy safe', () => {
  render(<TargetScreen {...props({ scan: flaggedDelegatecall() })} />)
  expect(screen.queryByText(/never rates it safe/)).toBeNull()
  expect(screen.getByRole('button', { name: copy.target.flagProxy })).toBeInTheDocument()
})

test('a flagged DELEGATECALL without an implementation slot offers the on-chain flag, as ux.md 6.5 says', () => {
  render(<TargetScreen {...props({ scan: flaggedDelegatecall() })} />)
  expect(screen.getByText(copy.target.proxyTitle)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.target.flagProxy })).toBeInTheDocument()
})

test('no banner and no flag button when the scan found neither a proxy nor a DELEGATECALL', () => {
  render(<TargetScreen {...props({ scan: scan() })} />)
  expect(screen.queryByText(copy.target.proxyTitle)).toBeNull()
  expect(screen.queryByRole('button', { name: copy.target.flagProxy })).toBeNull()
})

test('a marked proxy does not offer the flag again', () => {
  const report = scan({
    source: { kind: 'contract', address, codehash, blockNumber: '52000000', implementation: { standard: 'eip1967', address, codehash } },
    suggestedVerdict: null,
  })
  render(<TargetScreen {...props({ scan: report, detail: detail({ hasDelegatecall: true }) })} />)
  expect(screen.queryByRole('button', { name: copy.target.flagProxy })).toBeNull()
  expect(screen.getByText(copy.target.proxyText)).toBeInTheDocument()
})

test('an unrated target invites "Be the first Guardian" and mentions +2 XP for the first three slots', () => {
  render(<TargetScreen {...props({ detail: detail({ tier: 'UNRATED' }) })} />)
  expect(screen.getByText(copy.attest.first)).toBeInTheDocument()
  expect(screen.getByText(copy.target.firstXp)).toBeInTheDocument()
})

test('an unknown id with a src offers "Scan again"', () => {
  render(<TargetScreen {...props({ detail: null, src: address })} />)
  expect(screen.getByText(copy.scan.expired)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.scan.again })).toHaveAttribute('href', `/app?q=${address}`)
})

test('an unknown id without a src says the result is no longer cached', () => {
  render(<TargetScreen {...props({ detail: null, src: null })} />)
  expect(screen.getByText(copy.scan.expired)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: copy.scan.again })).toBeNull()
})

test('a lagging chain shows how many blocks behind the data is', () => {
  render(<TargetScreen {...props({ blocksBehind: 12 })} />)
  expect(screen.getByText('Data is 12 blocks behind.')).toBeInTheDocument()
})

test('a skill shows the repository, a short bundle hash and the version rated', () => {
  const contentHash = `0x${'55'.repeat(32)}` as const
  const bundle = canonicalBundleHash(contentHash, address)
  const skillId = targetIdOfSkill(bundle)
  const report = ScanReport.parse({
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: skillId,
    source: {
      kind: 'skill',
      repo: 'sealflare/guard',
      commit: 'a'.repeat(40),
      path: 'skills/guard',
      contentHash,
      manifestPublisher: address,
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
  const skill = detail({
    targetId: skillId,
    targetType: 'AI_SKILL_BUNDLE',
    label: 'sealflare/guard',
    src: 'gh:sealflare/guard@' + 'a'.repeat(40) + ':skills/guard',
    pinnedCodehash: bundle,
  })
  render(<TargetScreen {...props({ detail: skill, scan: report })} />)
  expect(screen.getByRole('heading', { name: 'sealflare/guard' })).toBeInTheDocument()
  expect(screen.getAllByText(shortAddress(bundle)).length).toBeGreaterThan(0)
  expect(screen.getByText('aaaaaaa')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.viewRepository })).toHaveAttribute('href', 'https://github.com/sealflare/guard')
})

test('an indexed skill with src null opens by ID and hides Scan again', () => {
  const skill = detail({ targetType: 'AI_SKILL_BUNDLE', label: 'sealflare/guard', src: null })
  render(<TargetScreen {...props({ detail: skill, src: null })} />)
  expect(screen.getByRole('heading', { name: 'sealflare/guard' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: copy.scan.again })).toBeNull()
})

test('an attestation with an empty evidence URI is shown without an evidence link', async () => {
  render(<TargetScreen {...props({ attestations: [row({ evidenceURI: '' })] })} />)
  await userEvent.click(screen.getByRole('tab', { name: /Attestations/ }))
  expect(screen.queryByRole('link', { name: copy.target.evidence })).toBeNull()
  expect(screen.getByRole('link', { name: '0x33333333' })).toBeInTheDocument()
})

test('an attestation with evidence shows the evidence and the transaction', async () => {
  render(<TargetScreen {...props({ attestations: [row()] })} />)
  await userEvent.click(screen.getByRole('tab', { name: /Attestations/ }))
  expect(screen.getByRole('link', { name: copy.target.evidence })).toHaveAttribute('href', 'https://example.org/evidence/1')
})

test('loading shows a skeleton of the same shape', () => {
  const { container } = render(<TargetSkeleton />)
  expect(container.querySelectorAll('.sf-skeleton').length).toBeGreaterThan(1)
  expect(screen.getAllByRole('status')[0]).toHaveAttribute('aria-label', copy.common.loading)
})

test('a failed load says the on-chain data is safe and offers a retry', () => {
  render(<TargetScreen {...props({ failed: true })} />)
  expect(screen.getByText(copy.common.onChainSafe)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.common.retry })).toBeInTheDocument()
})

test('the attest button opens without a wallet and says that a wallet is needed', () => {
  render(<TargetScreen {...props()} />)
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeEnabled()
  expect(screen.getByText(copy.target.attestHint)).toBeInTheDocument()
})

test('the attest button opens for a holder with quota left', () => {
  wallet.current = { kind: 'holder', isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  render(<TargetScreen {...props()} />)
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeEnabled()
  expect(screen.getByText('3 of 5 attestations left today')).toBeInTheDocument()
})

test('a contract whose code changed since it was sealed closes Attest and says why', () => {
  wallet.current = { kind: 'holder', isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  render(<TargetScreen {...props({ detail: detail({ tier: 'STALE_CODEHASH_DRIFT' }) })} />)
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeDisabled()
  expect(screen.getByText(copy.errors.CodeChangedSincePin)).toBeInTheDocument()
})

test('a skill that changed turns Attest into "Scan the current version"', () => {
  wallet.current = { kind: 'holder', isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  render(<TargetScreen {...props({ detail: skillDetail(), bundleChanged: true })} />)
  expect(screen.queryByRole('button', { name: copy.attest.action })).toBeNull()
  expect(screen.getByRole('link', { name: copy.target.currentVersion })).toHaveAttribute(
    'href',
    `/app?q=${encodeURIComponent('https://github.com/sealflare/guard')}`,
  )
})

test('a changed skill with no known source still does not offer Attest', () => {
  wallet.current = { kind: 'holder', isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  render(<TargetScreen {...props({ detail: skillDetail({ src: null }), bundleChanged: true })} />)
  expect(screen.queryByRole('button', { name: copy.attest.action })).toBeNull()
  expect(screen.getByRole('button', { name: copy.target.currentVersion })).toBeDisabled()
})

test('a tier that is not stale keeps the normal Attest button for a skill', () => {
  wallet.current = { kind: 'holder', isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 3 }
  render(<TargetScreen {...props({ detail: skillDetail({ tier: 'COMMUNITY_SAFE' }) })} />)
  expect(screen.getByRole('button', { name: copy.attest.action })).toBeEnabled()
})

test('a link that names another bundle says so, and the page offers no version of it', () => {
  render(<TargetScreen {...props({ detail: skillDetail({ tier: 'STALE_CODEHASH_DRIFT', src: null }), differentBundle: true })} />)
  expect(screen.getByText(copy.target.differentBundle)).toBeInTheDocument()
  // The foreign source is not attached to the target, so there is nothing to scan again.
  expect(screen.queryByRole('link', { name: copy.target.currentVersion })).toBeNull()
})

test('the page never links to another target page as a new version of the rated skill', () => {
  render(<TargetScreen {...props({ detail: skillDetail({ tier: 'STALE_CODEHASH_DRIFT' }), differentBundle: true })} />)
  for (const link of screen.queryAllByRole('link')) expect(link.getAttribute('href')).not.toContain('/app/t/')
})

test('verdicts are shown in sentence case, not as the raw enum', async () => {
  render(<TargetScreen {...props({ attestations: [row({ verdict: 'SAFE' }), row({ index: 1, verdict: 'CAUTION' }), row({ index: 2, verdict: 'DANGER' })] })} />)
  await userEvent.click(screen.getByRole('tab', { name: /Attestations/ }))
  const table = screen.getByRole('table', { name: copy.target.attestations })
  for (const word of ['Safe', 'Caution', 'Danger']) expect(within(table).getByText(word)).toBeInTheDocument()
  for (const raw of ['SAFE', 'CAUTION', 'DANGER']) expect(within(table).queryByText(raw)).toBeNull()
})

test('the history names each vote in sentence case and keeps two votes of the same second apart', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<TargetScreen {...props({ attestations: [row({ index: 0, verdict: 'SAFE' }), row({ index: 1, verdict: 'SAFE' })] })} />)
  await userEvent.click(screen.getByRole('tab', { name: copy.target.history }))
  expect(screen.getAllByText('Safe attestation')).toHaveLength(2)
  expect(screen.queryByText(/SAFE attestations/)).toBeNull()
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/)
  errors.mockRestore()
})

test('when the evidence links could not be read the tab says so, instead of showing None as if no proof was linked', async () => {
  render(<TargetScreen {...props({ attestations: [row({ evidenceURI: '', txHash: `0x${'0'.repeat(64)}` })], evidenceFailed: true })} />)
  await userEvent.click(screen.getByRole('tab', { name: /Attestations/ }))
  expect(screen.getByText(copy.target.evidenceUnavailable)).toBeInTheDocument()
  const table = screen.getByRole('table', { name: copy.target.attestations })
  expect(within(table).getAllByText(copy.target.unavailable)).toHaveLength(2)
  expect(within(table).queryByText(copy.target.none)).toBeNull()
})

test('with the evidence read working, an empty URI still reads None', async () => {
  render(<TargetScreen {...props({ attestations: [row({ evidenceURI: '' })] })} />)
  await userEvent.click(screen.getByRole('tab', { name: /Attestations/ }))
  expect(screen.queryByText(copy.target.evidenceUnavailable)).toBeNull()
  const table = screen.getByRole('table', { name: copy.target.attestations })
  expect(within(table).getAllByText(copy.target.none).length).toBeGreaterThan(0)
})
