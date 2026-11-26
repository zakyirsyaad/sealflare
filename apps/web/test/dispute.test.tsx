import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { XP } from '@sealflare/shared/rules'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { DisputeScreen } from '../components/dispute/DisputeScreen'
import { DisputesScreen } from '../components/dispute/DisputesScreen'
import { DisputeTab } from '../components/target/DisputeTab'
import { copy } from '../lib/copy'
import { config, resetDispute, state, wagmi } from './dispute.mocks'
import { CHALLENGER, COURT, CORE, JUROR_ONE, ME, NOW, closedUpheld, detail, iso, summary, targetId } from './dispute.fixtures'

type ScreenProps = Parameters<typeof DisputeScreen>[0]

function screenProps(overrides: Partial<ScreenProps> = {}): ScreenProps {
  return { detail: detail(), publisherRole: 'NONE', publisher: null, failed: false, ...overrides }
}

function dispute(overrides: Partial<ScreenProps> = {}) {
  return render(<DisputeScreen {...screenProps(overrides)} />)
}

beforeEach(resetDispute)

afterEach(() => {
  vi.useRealTimers()
})

// ---- the dispute page ----------------------------------------------------------------------

test('during the commit phase the page shows the juror count and never a vote direction', () => {
  // The index says the reveal phase has begun and holds a direction, but the chain says commit.
  wagmi.reads.current.phaseOf = 1
  dispute({
    detail: detail({
      phase: 'REVEAL',
      commits: 2,
      jurors: [
        { address: JUROR_ONE, weight: 3, revealed: true, uphold: true },
        { address: CHALLENGER, weight: 2, revealed: false, uphold: null },
      ],
      upholdWeight: 3,
    }),
  })
  const jury = screen.getByRole('complementary', { name: copy.dispute.jury })
  expect(within(jury).getByText('2 committed')).toBeInTheDocument()
  expect(within(jury).getByText(copy.dispute.votesHidden)).toBeInTheDocument()
  expect(within(jury).queryByText(copy.jury.uphold)).toBeNull()
  expect(within(jury).queryByText(copy.jury.reject)).toBeNull()
  expect(within(jury).queryByText(copy.dispute.weightUphold)).toBeNull()
  expect(screen.queryByRole('table', { name: copy.dispute.jurors })).toBeNull()
})

test('the phase strip counts down and the phase comes from Court.phaseOf', () => {
  vi.useFakeTimers({ now: NOW })
  wagmi.reads.current.phaseOf = 1
  const { unmount } = dispute()
  let active = screen.getByRole('listitem', { current: 'step' })
  expect(within(active).getByText(copy.dispute.phaseCommit)).toBeInTheDocument()
  expect(within(active).getByText('4h 12m left')).toBeInTheDocument()
  act(() => {
    vi.advanceTimersByTime(60_000)
  })
  expect(within(screen.getByRole('listitem', { current: 'step' })).getByText('4h 11m left')).toBeInTheDocument()
  unmount()

  // The index still says commit, the chain says reveal: the chain wins.
  wagmi.reads.current.phaseOf = 2
  dispute({ detail: detail({ phase: 'COMMIT' }) })
  active = screen.getByRole('listitem', { current: 'step' })
  expect(within(active).getByText(copy.dispute.phaseReveal)).toBeInTheDocument()
  // The clock of the first part moved one minute on, and the countdown follows it.
  expect(within(active).getByText('16h 11m left')).toBeInTheDocument()
  expect(wagmi.readCalls.some(call => call.functionName === 'phaseOf' && call.args?.[0] === 12n)).toBe(true)
})

test('the verified publisher sees "Submit reply" during commit; a sponsor does not', () => {
  state.value = { kind: 'holder', address: ME, isLoading: false, isError: false, recheck: () => {} }
  const { unmount } = dispute({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })
  expect(screen.getByRole('button', { name: copy.dispute.submitReply })).toBeEnabled()
  unmount()

  const sponsor = dispute({ publisherRole: 'THIRD_PARTY_SPONSOR', publisher: ME })
  expect(screen.queryByRole('button', { name: copy.dispute.submitReply })).toBeNull()
  expect(screen.getByText(copy.dispute.sponsorCannotReply)).toBeInTheDocument()
  sponsor.unmount()

  wagmi.reads.current.phaseOf = 2
  dispute({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })
  expect(screen.queryByRole('button', { name: copy.dispute.submitReply })).toBeNull()
  expect(screen.getByText(copy.dispute.replyClosed)).toBeInTheDocument()
})

test('another wallet does not see "Submit reply" even for a verified publisher', () => {
  state.value = { kind: 'holder', address: JUROR_ONE, isLoading: false, isError: false, recheck: () => {} }
  dispute({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })
  expect(screen.queryByRole('button', { name: copy.dispute.submitReply })).toBeNull()
})

test('the reply panel is left when the Court leaves the commit phase', async () => {
  state.value = { kind: 'holder', address: ME, isLoading: false, isError: false, recheck: () => {} }
  const view = dispute({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submitReply }))
  expect(screen.getByRole('heading', { name: copy.dispute.submitReply })).toBeInTheDocument()
  // The chain read refreshes every fifteen seconds, and the phase is no longer the commit phase.
  wagmi.reads.current.phaseOf = 2
  view.rerender(<DisputeScreen {...screenProps({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })} />)
  expect(screen.queryByRole('heading', { name: copy.dispute.submitReply })).toBeNull()
})

test('the reply panel is left when the wallet is no longer the verified publisher', async () => {
  state.value = { kind: 'holder', address: ME, isLoading: false, isError: false, recheck: () => {} }
  const view = dispute({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submitReply }))
  expect(screen.getByRole('heading', { name: copy.dispute.submitReply })).toBeInTheDocument()
  state.value = { kind: 'holder', address: JUROR_ONE, isLoading: false, isError: false, recheck: () => {} }
  view.rerender(<DisputeScreen {...screenProps({ publisherRole: 'VERIFIED_PUBLISHER', publisher: ME })} />)
  expect(screen.queryByRole('heading', { name: copy.dispute.submitReply })).toBeNull()
})

test('a target with no publisher says "No publisher is bound to this target, so no reply is possible." with no countdown', () => {
  dispute({ publisherRole: 'NONE', publisher: null })
  const reply = screen.getByRole('region', { name: copy.dispute.reply })
  expect(within(reply).getByText('No publisher is bound to this target, so no reply is possible.')).toBeInTheDocument()
  expect(within(reply).queryByText(/closes in/)).toBeNull()
  expect(within(reply).queryByRole('button')).toBeNull()
})

test('a closed challenge shows the verdict, the weight on each side, revealed votes and who received what', () => {
  wagmi.reads.current.phaseOf = 4
  wagmi.reads.current.getChallenge = { commits: 3, reveals: 3, outcome: 1 }
  dispute({ detail: closedUpheld() })
  expect(screen.getByText(copy.dispute.verdictUpheld)).toBeInTheDocument()
  expect(screen.getByText('Weight to uphold')).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.getByText('Weight to reject')).toBeInTheDocument()
  const jurors = screen.getByRole('table', { name: copy.dispute.jurors })
  expect(within(jurors).getAllByText(copy.jury.uphold)).toHaveLength(2)
  expect(within(jurors).getAllByText(copy.jury.reject)).toHaveLength(1)
  const payouts = screen.getByRole('table', { name: copy.dispute.payouts })
  expect(within(payouts).getByText('0.01 BNB')).toBeInTheDocument()
  expect(within(payouts).getByText('0.005 BNB')).toBeInTheDocument()
})

test('a juror who did not reveal is named as such after the vote', () => {
  wagmi.reads.current.phaseOf = 4
  dispute({
    detail: closedUpheld({
      jurors: [
        { address: JUROR_ONE, weight: 3, revealed: true, uphold: true },
        { address: CHALLENGER, weight: 2, revealed: false, uphold: null },
      ],
    }),
  })
  const jurors = screen.getByRole('table', { name: copy.dispute.jurors })
  expect(within(jurors).getByText(copy.dispute.notRevealed)).toBeInTheDocument()
})

test('after a danger verdict anyone sees "Apply penalties (N pending)"', () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  wagmi.reads.current.phaseOf = 4
  wagmi.reads.current.getChallenge = { commits: 3, reveals: 3, outcome: 1 }
  wagmi.reads.current.pendingPenalties = 3
  dispute({ detail: closedUpheld() })
  expect(screen.getByRole('button', { name: 'Apply penalties (3 pending)' })).toBeInTheDocument()
  expect(wagmi.readCalls.some(call => call.functionName === 'pendingPenalties' && call.args?.[0] === targetId)).toBe(true)
})

test('Apply penalties writes through Core for the whole list and is not offered when none are pending or the vote was not upheld', async () => {
  wagmi.reads.current.phaseOf = 4
  wagmi.reads.current.getChallenge = { commits: 3, reveals: 3, outcome: 1 }
  wagmi.reads.current.pendingPenalties = 2
  const first = dispute({ detail: closedUpheld() })
  await userEvent.click(screen.getByRole('button', { name: 'Apply penalties (2 pending)' }))
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { functionName: string; address: string; args: unknown[] }
  expect(written.functionName).toBe('applyPenalties')
  expect(written.address).toBe(CORE)
  expect(written.args).toEqual([targetId, 0, 5])
  first.unmount()

  wagmi.reads.current.pendingPenalties = 0
  const none = dispute({ detail: closedUpheld() })
  expect(screen.queryByRole('button', { name: /Apply penalties/ })).toBeNull()
  none.unmount()

  wagmi.reads.current.pendingPenalties = 2
  wagmi.reads.current.getChallenge = { commits: 3, reveals: 3, outcome: 2 }
  dispute({ detail: closedUpheld({ outcome: 'REJECTED' }) })
  expect(screen.queryByRole('button', { name: /Apply penalties/ })).toBeNull()
})

test('Resolve and Expire are offered to anyone, each saying it costs gas, and only the applicable one shows', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  wagmi.reads.current.phaseOf = 3
  wagmi.reads.current.getChallenge = { commits: 4, reveals: 3, outcome: 0 }
  const resolve = dispute({ detail: detail({ phase: 'AWAITING_CLOSE', reveals: 3, commits: 4 }) })
  expect(screen.getByRole('button', { name: copy.dispute.resolve })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.dispute.expire })).toBeNull()
  expect(screen.getByText(copy.dispute.gasNote)).toBeInTheDocument()
  resolve.unmount()

  wagmi.reads.current.getChallenge = { commits: 4, reveals: 2, outcome: 0 }
  const expire = dispute({ detail: detail({ phase: 'AWAITING_CLOSE', reveals: 2, commits: 4 }) })
  expect(screen.getByRole('button', { name: copy.dispute.expire })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.dispute.resolve })).toBeNull()
  expect(screen.getByText(copy.dispute.gasNote)).toBeInTheDocument()
  expire.unmount()

  wagmi.reads.current.phaseOf = 1
  dispute()
  expect(screen.queryByRole('button', { name: copy.dispute.resolve })).toBeNull()
  expect(screen.queryByRole('button', { name: copy.dispute.expire })).toBeNull()
})

test.each([
  ['resolve', 3, copy.dispute.resolve],
  ['expire', 2, copy.dispute.expire],
])('%s sends the id of the dispute to the Court from the wallet of the user', async (functionName, reveals, label) => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  wagmi.reads.current.phaseOf = 3
  wagmi.reads.current.getChallenge = { commits: 4, reveals, outcome: 0 }
  dispute({ detail: detail({ phase: 'AWAITING_CLOSE' }) })
  await userEvent.click(screen.getByRole('button', { name: label }))
  expect(wagmi.writeContractAsync).toHaveBeenCalledWith(
    expect.objectContaining({ functionName, address: COURT, args: [12n], account: ME, chainId: 56 }),
  )
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
})

test('the dispute page says it was not found, and never invents a dispute', () => {
  dispute({ detail: null })
  expect(screen.getByText(copy.dispute.notFound)).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: copy.dispute.jury })).toBeNull()
})

test('a page that could not be read says so and offers a retry, with the chain untouched', () => {
  dispute({ failed: true, detail: null })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByText(copy.common.onChainSafe)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.common.retry })).toBeInTheDocument()
})

test('the page links the evidence of the challenger and the reply of the publisher', () => {
  dispute({ detail: detail({ counterEvidenceURI: 'ipfs://bafyreply' }), publisherRole: 'VERIFIED_PUBLISHER', publisher: CHALLENGER })
  expect(screen.getByRole('link', { name: copy.dispute.fullEvidence })).toHaveAttribute('href', 'https://ipfs.io/ipfs/bafyevidence')
  expect(screen.getByRole('link', { name: copy.dispute.fullReply })).toHaveAttribute('href', 'https://ipfs.io/ipfs/bafyreply')
  expect(screen.getByText(copy.dispute.replySubmitted)).toBeInTheDocument()
})

test('an evidence URI that is not a link is shown without one', () => {
  dispute({ detail: detail({ evidenceURI: 'javascript:alert(1)' }) })
  expect(screen.queryByRole('link', { name: copy.dispute.fullEvidence })).toBeNull()
  expect(screen.getByText(copy.dispute.evidenceUnavailable)).toBeInTheDocument()
})

test('the page names the four endings and what each returns', () => {
  dispute()
  const table = screen.getByRole('table', { name: copy.dispute.outcomesTitle })
  for (const word of [copy.dispute.outcomeUpheld, copy.dispute.outcomeRejected, copy.dispute.outcomeTied, copy.dispute.outcomeExpired]) {
    expect(within(table).getByRole('rowheader', { name: word })).toBeInTheDocument()
  }
  // The money and the XP come from the rules, never from a second copy of them in the copy.
  expect(within(table).getByText('80%, 50% or 0% of the stake back')).toBeInTheDocument()
  expect(within(table).getByText(`Stake lost, ${XP.CHALLENGER_LOST} XP`)).toBeInTheDocument()
})

test('with modules not live the dispute page shows the fixed sentence and no dispute', () => {
  config.modulesLive = false
  dispute()
  expect(screen.getByText(copy.common.modulesNotLive)).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: copy.dispute.jury })).toBeNull()
})

// ---- the list ------------------------------------------------------------------------------

test('the list shows phase and time left, and an empty list explains itself', () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  const items = [
    summary(),
    summary({ id: '11', phase: 'REVEAL', commits: 3, reveals: 1, commitEndsAt: iso(-2), revealEndsAt: iso(10) }),
    summary({ id: '10', phase: 'AWAITING_CLOSE', commitEndsAt: iso(-20), revealEndsAt: iso(-8) }),
    summary({ id: '9', phase: 'CLOSED', outcome: 'UPHELD', commitEndsAt: iso(-60), revealEndsAt: iso(-48) }),
  ]
  const { unmount } = render(<DisputesScreen items={items} failed={false} />)
  const table = screen.getByRole('table', { name: copy.dispute.listTitle })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(4)
  expect(within(rows[0]!).getByText(copy.dispute.phaseCommit)).toBeInTheDocument()
  expect(within(rows[0]!).getByText('4h 12m left')).toBeInTheDocument()
  expect(within(rows[0]!).getByRole('link', { name: '#12' })).toHaveAttribute('href', '/app/disputes/12')
  expect(within(rows[1]!).getByText(copy.dispute.phaseReveal)).toBeInTheDocument()
  expect(within(rows[1]!).getByText('10h 0m left')).toBeInTheDocument()
  expect(within(rows[2]!).getByText(copy.dispute.phaseReady)).toBeInTheDocument()
  expect(within(rows[3]!).getByText(copy.dispute.outcomeUpheld)).toBeInTheDocument()
  unmount()

  render(<DisputesScreen items={[]} failed={false} />)
  expect(screen.getByText(copy.dispute.listEmpty)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.dispute.listEmptyAction })).toHaveAttribute('href', '/app/explore')
})

test('a list that could not be read is an error and never an empty list', () => {
  render(<DisputesScreen items={[]} failed />)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText(copy.dispute.listEmpty)).toBeNull()
})

test('with modules not live the Disputes page is empty with the fixed sentence', () => {
  config.modulesLive = false
  render(<DisputesScreen items={[summary()]} failed={false} />)
  expect(screen.getByText(copy.common.modulesNotLive)).toBeInTheDocument()
  expect(screen.queryByRole('table')).toBeNull()
})

// ---- the tab -------------------------------------------------------------------------------

test('the Dispute tab lists the disputes of the target and links the open one', () => {
  render(<DisputeTab challenges={[summary(), summary({ id: '8', phase: 'CLOSED', outcome: 'REJECTED' })]} activeChallengeId="12" />)
  expect(screen.getByRole('link', { name: '#12' })).toHaveAttribute('href', '/app/disputes/12')
  expect(screen.getByRole('link', { name: '#8' })).toHaveAttribute('href', '/app/disputes/8')
  expect(screen.getByText(copy.dispute.outcomeRejected)).toBeInTheDocument()
})

test('the Dispute tab is empty with its sentence when the target has no disputes', () => {
  render(<DisputeTab challenges={[]} activeChallengeId={null} />)
  expect(screen.getByText(copy.target.noDisputes)).toBeInTheDocument()
})

test('the Dispute tab still names the open dispute when the list could not be read', () => {
  render(<DisputeTab challenges={null} activeChallengeId="12" />)
  expect(screen.getByRole('link', { name: copy.dispute.viewOpen })).toHaveAttribute('href', '/app/disputes/12')
})

// ---- review round 1 ------------------------------------------------------------------------

test('Resolve that was mined but reverted is a failure, never "Waiting for finality"', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null, data: { status: 'reverted' } } as never
  wagmi.reads.current.phaseOf = 3
  wagmi.reads.current.getChallenge = { commits: 4, reveals: 3, outcome: 0 }
  dispute({ detail: detail({ phase: 'AWAITING_CLOSE' }) })
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.resolve }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.unknown)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
})

test.each([
  ['the attestation count is not known yet', undefined],
  ['the list holds no attestation', { attestationCount: 0 }],
])('Apply penalties cannot be sent while %s, because it would apply nothing and still cost gas', async (_name, target) => {
  wagmi.reads.current.phaseOf = 4
  wagmi.reads.current.getChallenge = { commits: 3, reveals: 3, outcome: 1 }
  wagmi.reads.current.pendingPenalties = 2
  wagmi.reads.current.getTarget = target
  dispute({ detail: closedUpheld() })
  const button = screen.getByRole('button', { name: 'Apply penalties (2 pending)' })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('the phase strip is named as the phases, and the endings table keeps its own name', () => {
  dispute()
  expect(screen.getByRole('list', { name: 'Dispute phases' })).toBeInTheDocument()
  expect(screen.getByRole('table', { name: copy.dispute.outcomesTitle })).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: copy.dispute.outcomesTitle })).toBeNull()
})

test('a skill is named by its repository on the dispute page, and an address is shortened', () => {
  const skill = dispute({ detail: detail({ label: 'sealflare/guard' }) })
  expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('sealflare/guard')
  skill.unmount()
  dispute()
  expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('0x60b9…022f')
})
