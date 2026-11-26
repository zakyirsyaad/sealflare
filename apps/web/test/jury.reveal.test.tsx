import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UserRejectedRequestError } from 'viem'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { JuryActions } from '../components/jury/JuryActions'
import { RevealPanel } from '../components/jury/RevealPanel'
import { copy } from '../lib/copy'
import { commitHashFor, saveRevealCode } from '../lib/revealCode'
import { chainTakes, resetDispute, state, wagmi } from './dispute.mocks'
import { COURT, ME, NOW } from './dispute.fixtures'

const OTHER = '0x7100000000000000000000000000000000000001'
const SALT = '11'.repeat(32)
/** The code this juror committed with: uphold on challenge 12. */
const MINE = `sf1.12.u.${SALT}`
const COMMIT_ENDS = new Date(NOW.getTime() - 2 * 3_600_000).toISOString()
const REVEAL_ENDS = new Date(NOW.getTime() + 10 * 3_600_000).toISOString()

function committed(overrides: Record<string, unknown> = {}) {
  return { committed: true, revealed: false, uphold: false, weight: 3, commitHash: commitHashFor(MINE, ME), ...overrides }
}

function reveal(overrides: Partial<Parameters<typeof RevealPanel>[0]> = {}) {
  return render(<RevealPanel challengeId="12" phase="REVEAL" commitEndsAt={COMMIT_ENDS} onClose={() => {}} {...overrides} />)
}

const revealButton = () => screen.getByRole('button', { name: copy.jury.reveal })
const paste = (text: string) => userEvent.type(screen.getByLabelText(copy.jury.pasteCode), text)

beforeEach(() => {
  resetDispute()
  localStorage.clear()
  wagmi.reads.current.getJuror = committed()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the code is kept in local storage so a reveal from the same device is one click', async () => {
  saveRevealCode(MINE, ME)
  reveal()
  expect(screen.getByText(copy.jury.codeSaved)).toBeInTheDocument()
  await userEvent.click(revealButton())
  expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1)
  expect(wagmi.writeContractAsync).toHaveBeenCalledWith(
    expect.objectContaining({ functionName: 'revealVote', address: COURT, account: ME, chainId: 56, args: [12n, true, `0x${SALT}`] }),
  )
  expect(wagmi.signMessageAsync).not.toHaveBeenCalled()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
})

test('a pasted code is checked against the on-chain commit hash before anything is sent', async () => {
  reveal()
  expect(revealButton()).toBeDisabled()
  await paste(`  ${MINE}\n`)
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
  await userEvent.click(revealButton())
  expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1)
  expect((wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }).args).toEqual([12n, true, `0x${SALT}`])
})

test('the commit hash is read from the Court for this dispute and this wallet', () => {
  reveal()
  expect(wagmi.readCalls.some(call => call.functionName === 'getJuror' && call.args?.[0] === 12n && call.args?.[1] === ME)).toBe(true)
})

test.each([
  ['for another challenge', `sf1.13.u.${SALT}`, copy.jury.codeOtherChallenge],
  ['with the direction flipped', `sf1.12.r.${SALT}`, copy.errors.CommitMismatch],
  ['malformed', `sf1.12.u.${'z'.repeat(64)}`, copy.jury.codeMalformed],
  ['belonging to another juror', `sf1.12.u.${'22'.repeat(32)}`, copy.errors.CommitMismatch],
])('a code %s sends no transaction and tells the juror', async (_name, code, message) => {
  reveal()
  await paste(code)
  await userEvent.click(revealButton())
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
})

test('a code that another juror committed with does not match this juror, whoever pasted it', async () => {
  const theirs = `sf1.12.u.${'33'.repeat(32)}`
  wagmi.reads.current.getJuror = committed({ commitHash: commitHashFor(theirs, OTHER) })
  reveal()
  await paste(theirs)
  await userEvent.click(revealButton())
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.CommitMismatch)
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a saved code that does not match the commit is not offered for one click', async () => {
  saveRevealCode(`sf1.12.r.${SALT}`, ME)
  reveal()
  expect(screen.queryByText(copy.jury.codeSaved)).toBeNull()
  expect(revealButton()).toBeDisabled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('a pasted code wins over a saved one, and both are checked', async () => {
  saveRevealCode(`sf1.12.r.${SALT}`, ME)
  reveal()
  await paste(MINE)
  await userEvent.click(revealButton())
  expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1)
})

test('the error goes away when the juror edits the code', async () => {
  reveal()
  await paste('nonsense')
  await userEvent.click(revealButton())
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await userEvent.clear(screen.getByLabelText(copy.jury.pasteCode))
  await paste(MINE)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('until the commit hash is read nothing can be revealed', async () => {
  wagmi.reads.current.getJuror = undefined
  saveRevealCode(MINE, ME)
  reveal()
  expect(screen.getByText(copy.jury.readingCommit)).toBeInTheDocument()
  expect(revealButton()).toBeDisabled()
})

test('a juror who did not commit has nothing to reveal', () => {
  wagmi.reads.current.getJuror = committed({ committed: false })
  reveal()
  expect(screen.getByText(copy.jury.notCommitted)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
})

test('a vote that was revealed already is shown, and cannot be revealed again', () => {
  wagmi.reads.current.getJuror = committed({ revealed: true, uphold: true })
  reveal()
  expect(screen.getByText(copy.jury.alreadyRevealed)).toBeInTheDocument()
  expect(screen.getByText('Your vote: Uphold')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
})

test('after revealing, the vote shows with "Waiting for finality"', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('reveal')
  saveRevealCode(MINE, ME)
  reveal()
  await userEvent.click(revealButton())
  expect(await screen.findByText('Your vote: Uphold')).toBeInTheDocument()
  expect(screen.getByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
})

test('a reveal that was mined but reverted is a failure and the vote is not shown as revealed', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null, data: { status: 'reverted' } }
  saveRevealCode(MINE, ME)
  reveal()
  await userEvent.click(revealButton())
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.unknown)
  expect(screen.queryByText('Your vote: Uphold')).toBeNull()
})

test('refusing the transaction in the wallet returns to the reveal with no error', async () => {
  wagmi.writeContractAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  saveRevealCode(MINE, ME)
  reveal()
  await userEvent.click(revealButton())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(revealButton()).toBeEnabled()
})

test('a revert names its reason, and the retry sends the same reveal', async () => {
  wagmi.writeContractAsync.mockRejectedValueOnce(
    Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError', data: { errorName: 'WrongPhase', args: [3] } }),
  )
  saveRevealCode(MINE, ME)
  reveal()
  await userEvent.click(revealButton())
  expect(await screen.findByText('This action is not available right now (closing step).')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  expect((wagmi.writeContractAsync.mock.calls[1]?.[0] as { args: readonly unknown[] }).args).toEqual([12n, true, `0x${SALT}`])
})

test.each([
  ['COMMIT', copy.jury.revealNotOpen.replace('{time}', '2026-12-01 08:00 UTC')],
  ['AWAITING_CLOSE', copy.jury.revealOver],
  ['CLOSED', copy.jury.revealOver],
] as const)('revealing outside the reveal window is not offered: phase %s', (phase, message) => {
  saveRevealCode(MINE, ME)
  reveal({ phase })
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
  expect(screen.queryByLabelText(copy.jury.pasteCode)).toBeNull()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('without a wallet, on the wrong network or without an Agent ID the panel shows that branch', () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  const first = reveal()
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
  expect(screen.queryByLabelText(copy.jury.pasteCode)).toBeNull()
  first.unmount()
  state.value = { kind: 'wrong-network', isLoading: false, isError: false, recheck: () => {} }
  reveal()
  expect(screen.getByRole('button', { name: /^Switch to/ })).toBeInTheDocument()
})

test('no code is printed to a log or put in a URL while revealing', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}))
  const before = window.location.href
  reveal()
  await paste(`sf1.12.u.${'zz'.repeat(32)}`)
  await userEvent.click(revealButton())
  await userEvent.clear(screen.getByLabelText(copy.jury.pasteCode))
  await paste(MINE)
  await userEvent.click(revealButton())
  for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SALT)
  expect(window.location.href).toBe(before)
  for (const element of document.querySelectorAll('[href], [src]')) {
    expect(element.getAttribute('href') ?? element.getAttribute('src') ?? '').not.toContain(SALT)
  }
})

// ---- the controls in the jury box ------------------------------------------------------------

function actions(phase: Parameters<typeof JuryActions>[0]['phase']) {
  return render(<JuryActions challengeId="12" phase={phase} commitEndsAt={COMMIT_ENDS} revealEndsAt={REVEAL_ENDS} />)
}

test('during the commit phase the jury box offers "Join the jury", and it opens the panel', async () => {
  wagmi.reads.current.getJuror = committed({ committed: false })
  actions('COMMIT')
  await userEvent.click(screen.getByRole('button', { name: copy.jury.join }))
  expect(screen.getByText(copy.jury.step[0])).toBeInTheDocument()
})

test('a juror who committed is told when the reveal window opens, and is not offered to join again', () => {
  actions('COMMIT')
  expect(screen.getByText(copy.jury.committedNote.replace('{time}', '2026-12-01 08:00 UTC'))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.join })).toBeNull()
})

test('during the reveal phase a juror who committed is offered "Reveal my vote", and it opens the panel', async () => {
  saveRevealCode(MINE, ME)
  actions('REVEAL')
  await userEvent.click(screen.getByRole('button', { name: copy.jury.reveal }))
  expect(screen.getByRole('heading', { name: copy.jury.revealTitle })).toBeInTheDocument()
})

test.each(['COMMIT', 'AWAITING_CLOSE', 'CLOSED', null] as const)('revealing is not offered in phase %s', phase => {
  actions(phase)
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
})

test('a juror who did not commit is offered no reveal in the reveal phase', () => {
  wagmi.reads.current.getJuror = committed({ committed: false })
  actions('REVEAL')
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
  expect(screen.queryByRole('button', { name: copy.jury.join })).toBeNull()
})

test('a juror who let the window pass is told the stake is lost', () => {
  actions('AWAITING_CLOSE')
  expect(screen.getByText(copy.jury.revealOver)).toBeInTheDocument()
})

test('the jury box offers nothing before the phase is known, and no vote direction is ever shown by it', () => {
  wagmi.reads.current.getJuror = committed({ revealed: true, uphold: true })
  const view = actions(null)
  expect(view.container).toBeEmptyDOMElement()
  view.unmount()
  actions('COMMIT')
  expect(screen.queryByText(copy.jury.uphold)).toBeNull()
  expect(screen.queryByText(/Your vote/)).toBeNull()
})

// ---- review round 1 ------------------------------------------------------------------------

test('the Court is asked again every few seconds, so a commit that landed turns "Join" into a note', () => {
  actions('COMMIT')
  for (const name of ['jurorStatus', 'getJuror']) {
    const call = wagmi.readCalls.find(item => item.functionName === name)
    expect(call?.query?.refetchInterval, name).toBeGreaterThan(0)
  }
})

test('closing the panel reads the Court again, so the box shows what the panel just did', async () => {
  wagmi.reads.current.getJuror = committed({ committed: false })
  actions('COMMIT')
  wagmi.refetch.mockClear()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.join }))
  await userEvent.click(screen.getByRole('button', { name: copy.common.close }))
  expect(wagmi.refetch).toHaveBeenCalled()
})

test('a deployment without a Court address says so instead of doing nothing', async () => {
  saveRevealCode(MINE, ME)
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: '0x1000000000000000000000000000000000000001',
  })
  reveal()
  // There is no Court to reveal to, so the panel says that and offers nothing to press.
  expect(await screen.findByText(copy.dispute.noCourt)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
  expect(screen.queryByLabelText(copy.jury.pasteCode)).toBeNull()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('the jury box says so when the deployment has no Court address', () => {
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: '0x1000000000000000000000000000000000000001',
  })
  actions('COMMIT')
  expect(screen.getByText(copy.dispute.noCourt)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.jury.join })).toBeNull()
})

// ---- review of the lead on #41 ---------------------------------------------------------------

test('a reveal that was cancelled in the wallet is not shown as revealed, even though a receipt came back', async () => {
  // The Court is asked again for a while before the panel believes that the vote is not there, so
  // the clock is moved by hand instead of waiting for it.
  vi.useFakeTimers()
  const user = userEvent.setup({
    advanceTimers: (delay: number) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(delay)
      return Promise.resolve()
    },
  })
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  saveRevealCode(MINE, ME)
  reveal()
  await user.click(revealButton())
  // The receipt arrives on a promise, so the panel is settled before the clock moves.
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent(copy.jury.revealNotFound)
  expect(screen.queryByText('Your vote: Uphold')).toBeNull()
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
  await user.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
})

test('the one-click reveal uses the saved code that matches the commit, even when a newer attempt is saved after it', async () => {
  saveRevealCode(MINE, ME)
  saveRevealCode(`sf1.12.r.${'44'.repeat(32)}`, ME)
  reveal()
  expect(screen.getByText(copy.jury.codeSaved)).toBeInTheDocument()
  await userEvent.click(revealButton())
  expect((wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }).args).toEqual([12n, true, `0x${SALT}`])
})

test('"Reveal my vote" is offered in the reveal phase before a wallet is connected, and the panel asks for one', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  // Without a wallet the read is disabled, so the Court answers nothing about this juror.
  wagmi.reads.current.getJuror = undefined
  actions('REVEAL')
  await userEvent.click(screen.getByRole('button', { name: copy.jury.reveal }))
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
  expect(screen.queryByLabelText(copy.jury.pasteCode)).toBeNull()
})

test('once a wallet is connected that did not commit, there is nothing to reveal', () => {
  wagmi.reads.current.getJuror = committed({ committed: false })
  actions('REVEAL')
  expect(screen.queryByRole('button', { name: copy.jury.reveal })).toBeNull()
})
