import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { JoinPanel } from '../components/jury/JoinPanel'
import { copy } from '../lib/copy'
import { commitHashFor, loadRevealCode, loadRevealCodes } from '../lib/revealCode'
import { chainTakes, resetDispute, wagmi } from './dispute.mocks'
import { ME, NOW, txHash } from './dispute.fixtures'

const COMMIT_ENDS = new Date(NOW.getTime() + 4 * 3_600_000).toISOString()
const REVEAL_ENDS = new Date(NOW.getTime() + 16 * 3_600_000).toISOString()

const clipboard = { writeText: vi.fn() }
const click = vi.fn()

const PROPS = { challengeId: '12', commitEndsAt: COMMIT_ENDS, revealEndsAt: REVEAL_ENDS, onClose: () => {} }

/** The clicks wait on a timer, so a test with fake timers has to move the clock itself. */
let user: ReturnType<typeof userEvent.setup>

function join_() {
  return render(<JoinPanel {...PROPS} />)
}

async function toCode() {
  await user.click(screen.getByRole('radio', { name: /^Uphold/ }))
  await user.click(screen.getByRole('button', { name: copy.jury.continue }))
  await user.click(screen.getByRole('button', { name: copy.jury.continue }))
}

const shownCode = () => (screen.getByLabelText(copy.jury.codeLabel) as HTMLInputElement).value
const commitButton = () => screen.getByRole('button', { name: copy.jury.commit })

async function commit() {
  await toCode()
  await user.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  const code = shownCode()
  await user.click(commitButton())
  return code
}

/**
 * Lets the panel catch up with the receipt of the transaction and the first answer of the Court.
 *
 * Both are promises, and a test with faked timers has to give the screen a turn of the event loop
 * before the clock is moved.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetDispute()
  localStorage.clear()
  clipboard.writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
  click.mockReset()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    click(this.download, this.href)
  })
  URL.createObjectURL = vi.fn(() => 'blob:sealflare-test')
  URL.revokeObjectURL = vi.fn()
  user = userEvent.setup({
    advanceTimers: (delay: number) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(delay)
      return Promise.resolve()
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---- review of the lead on #41 -----------------------------------------------------------------

test('a juror who goes through the commit twice keeps the first code, which is the one the chain holds', async () => {
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  const first = join_()
  const firstCode = await commit()
  first.unmount()
  join_()
  const secondCode = await commit()
  expect(secondCode).not.toBe(firstCode)
  expect(loadRevealCodes(12n, ME)).toEqual([firstCode, secondCode])
  expect(loadRevealCode(12n, ME, commitHashFor(firstCode, ME))).toBe(firstCode)
})

test('two downloads never share a file name, so the second cannot hide the first', async () => {
  const first = join_()
  await toCode()
  await user.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  const one = shownCode()
  first.unmount()
  join_()
  await toCode()
  await user.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  const two = shownCode()
  const names = click.mock.calls.map(call => String(call[0]))
  expect(names).toHaveLength(2)
  expect(names[0]).toBe(`sealflare-reveal-code-12-${commitHashFor(one, ME).slice(2, 10)}.txt`)
  expect(names[1]).toBe(`sealflare-reveal-code-12-${commitHashFor(two, ME).slice(2, 10)}.txt`)
  expect(names[0]).not.toBe(names[1])
  expect(names.join(' ')).not.toContain(one.slice(-64))
})

test('the commit is only confirmed once the chain shows it for this code', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  join_()
  await commit()
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(wagmi.refetch).toHaveBeenCalledWith('getJuror')
})

test('a commit that was cancelled in the wallet is not confirmed, even though a receipt came back', async () => {
  // The receipt is the one of the replacement, so it says success while the Court holds nothing.
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  join_()
  const code = await commit()
  await settle()
  // The Court is asked again and again, and the miss is only believed when the asking is over.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
  expect(screen.queryByText(copy.jury.noReminder)).toBeNull()
  await user.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  expect((wagmi.writeContractAsync.mock.calls[1]?.[0] as { args: readonly unknown[] }).args[1]).toBe(commitHashFor(code, ME))
})

test('a commit that the chain shows with another hash is not confirmed either', async () => {
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  wagmi.writeContractAsync.mockImplementation(async () => {
    wagmi.reads.current.getJuror = { committed: true, revealed: false, uphold: false, weight: 3, commitHash: `0x${'cd'.repeat(32)}` }
    return txHash
  })
  join_()
  await commit()
  await settle()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
})

test('a commit that the Court does not show is not called missing while the Court is still being asked', async () => {
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  join_()
  await commit()
  await settle()
  // The Court is being asked, so the panel says that it is checking and offers no retry.
  expect(screen.getByText(copy.jury.verifying)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
  // A node that is a few seconds behind must not be called a miss either: a retry would be refused
  // by the Court, and the gas of it would be lost.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000)
  })
  expect(screen.getByText(copy.jury.verifying)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
})

test('when every read fails and the asking is over, the polled state of the Court is the last word', async () => {
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  // Every read of the asking fails, while the polled state of the Court answers that it holds no commit.
  wagmi.refetch.mockImplementation(async () => ({ data: undefined, isError: true }))
  join_()
  await commit()
  await settle()
  // Nothing is known while the asking goes on, so nothing is said about the vote.
  expect(screen.getByText(copy.jury.verifying)).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  // The asking is over, so the commit that the Court does not hold is a miss and can be tried again.
  expect(screen.getByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
})

test('a commit the Court refuses because the juror already committed is not a failure to retry', async () => {
  // The first commit landed while a second one was on its way, so the Court refuses the second.
  wagmi.reads.current.getJuror = {
    committed: true,
    revealed: false,
    uphold: false,
    weight: 3,
    commitHash: `0x${'ab'.repeat(32)}`,
  }
  wagmi.writeContractAsync.mockRejectedValueOnce(
    Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError', data: { errorName: 'AlreadyCommitted', args: [] } }),
  )
  join_()
  await commit()
  // The vote is on the chain, so there is nothing to retry, but it is not the code of this panel.
  expect(await screen.findByText(copy.jury.committedElsewhere)).toBeInTheDocument()
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
  expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
})

test('a commit the Court holds with the code of this panel is confirmed, even when the transaction failed', async () => {
  // The transaction failed, but the Court holds the very commit that was sent.
  wagmi.writeContractAsync.mockImplementation(async (call: { args: readonly unknown[] }) => {
    const current = wagmi.reads.current.getJuror as Record<string, unknown>
    wagmi.reads.current.getJuror = { ...current, committed: true, commitHash: call.args[1] }
    throw Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError', data: { errorName: 'AlreadyCommitted', args: [] } })
  })
  join_()
  await commit()
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.queryByText(copy.jury.committedElsewhere)).toBeNull()
  expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
})

test('a commit that the chain shows later turns the miss into the confirmation', async () => {
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  const view = join_()
  const code = await commit()
  await settle()
  // The chain shows nothing yet, so the panel keeps checking and says nothing about the vote.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(screen.getByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
  // The commit turns up on the chain afterwards, so the panel confirms it after all. The poll of the
  // Court brings the answer, and a render is what the poll does to the panel.
  wagmi.reads.current.getJuror = {
    committed: true,
    revealed: false,
    uphold: false,
    weight: 3,
    commitHash: commitHashFor(code, ME),
  }
  view.rerender(<JoinPanel {...PROPS} />)
  expect(screen.getByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a read that failed keeps the panel checking, and never calls the vote missing', async () => {
  vi.useFakeTimers()
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  wagmi.readErrors.current.getJuror = true
  join_()
  await commit()
  await settle()
  expect(screen.getByText(copy.jury.verifying)).toBeInTheDocument()
  // The reads keep failing and the asking runs out, so nothing is known and nothing is said.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000)
  })
  expect(screen.getByText(copy.jury.verifying)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('while the chain is being asked, the panel says so and shows no confirmation', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  let code = ''
  let release: () => void = () => {}
  wagmi.refetch.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () => {
          wagmi.reads.current.getJuror = {
            committed: true,
            revealed: false,
            uphold: false,
            weight: 3,
            commitHash: commitHashFor(code, ME),
          }
          resolve({ data: wagmi.reads.current.getJuror, isError: false })
        }
      }),
  )
  join_()
  code = await commit()
  expect(await screen.findByText(copy.jury.verifying)).toBeInTheDocument()
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
  release()
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
})

test('the chain is asked again once the commit is done, so the box and a reopened panel are not stale', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  join_()
  wagmi.refetch.mockClear()
  await commit()
  await screen.findByText(copy.jury.committedTitle)
  // The asking of the Court runs once the commit is done, so the wait is on the asking itself.
  await waitFor(() => {
    const asked = wagmi.refetch.mock.calls.map(call => call[0])
    expect(asked).toContain('getJuror')
    expect(asked).toContain('jurorStatus')
  })
})

test('"Copy time" says that it replaces the clipboard, and does not count as taking the code', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  join_()
  await commit()
  await screen.findByText(copy.jury.committedTitle)
  expect(screen.getByText(copy.jury.copyTimeNote)).toBeInTheDocument()
})

test('a browser that cannot keep the code asks for a download, and copying alone is not enough', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  join_()
  await toCode()
  expect(screen.getByText(copy.jury.downloadRequired)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  await screen.findByText(copy.jury.copied)
  expect(commitButton()).toBeDisabled()
  await user.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
})

test('a browser that keeps the code does not ask for a download', async () => {
  join_()
  await toCode()
  expect(screen.queryByText(copy.jury.downloadRequired)).toBeNull()
})

test('a browser that did not keep the code is asked for a download once the commit is confirmed', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  join_()
  await toCode()
  await user.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  await user.click(commitButton())
  // The commit is on the chain, and this browser holds no copy of the code, so the file is asked for.
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.getByText(copy.jury.downloadAgainRequired)).toBeInTheDocument()
  const before = click.mock.calls.length
  // The handout button now reads "Downloaded", so the one left is the one of the confirmation.
  const again = screen.getAllByRole('button', { name: copy.jury.downloadCode }).at(-1) as HTMLElement
  await user.click(again)
  expect(click.mock.calls.length).toBe(before + 1)
})

test('a browser that kept the code is not asked for a download after the commit', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  join_()
  await commit()
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.queryByText(copy.jury.downloadAgainRequired)).toBeNull()
})
