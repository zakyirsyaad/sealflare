import { render, screen, waitFor } from '@testing-library/react'
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

function join_() {
  return render(<JoinPanel challengeId="12" commitEndsAt={COMMIT_ENDS} revealEndsAt={REVEAL_ENDS} onClose={() => {}} />)
}

async function toCode() {
  await userEvent.click(screen.getByRole('radio', { name: /^Uphold/ }))
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
}

const shownCode = () => (screen.getByLabelText(copy.jury.codeLabel) as HTMLInputElement).value
const commitButton = () => screen.getByRole('button', { name: copy.jury.commit })

async function commit() {
  await toCode()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  const code = shownCode()
  await userEvent.click(commitButton())
  return code
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
})

afterEach(() => {
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
  await userEvent.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  const one = shownCode()
  first.unmount()
  join_()
  await toCode()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
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
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  join_()
  const code = await commit()
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
  expect(screen.queryByText(copy.jury.noReminder)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  expect((wagmi.writeContractAsync.mock.calls[1]?.[0] as { args: readonly unknown[] }).args[1]).toBe(commitHashFor(code, ME))
})

test('a commit that the chain shows with another hash is not confirmed either', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  wagmi.writeContractAsync.mockImplementation(async () => {
    wagmi.reads.current.getJuror = { committed: true, revealed: false, uphold: false, weight: 3, commitHash: `0x${'cd'.repeat(32)}` }
    return txHash
  })
  join_()
  await commit()
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.jury.commitNotFound)
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
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
  // The vote is on the chain, so the panel says so and offers no retry that could never work.
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
})

test('while the chain is being asked, the panel says so and shows no confirmation', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  chainTakes('commit')
  let release: () => void = () => {}
  wagmi.refetch.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = () => resolve({ data: wagmi.reads.current.getJuror })
      }),
  )
  join_()
  await commit()
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
  const asked = wagmi.refetch.mock.calls.map(call => call[0])
  expect(asked).toContain('getJuror')
  expect(asked).toContain('jurorStatus')
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
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  await screen.findByText(copy.jury.copied)
  expect(commitButton()).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
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
  await userEvent.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  await userEvent.click(commitButton())
  // The commit is on the chain, and this browser holds no copy of the code, so the file is asked for.
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.getByText(copy.jury.downloadAgainRequired)).toBeInTheDocument()
  const before = click.mock.calls.length
  // The handout button now reads "Downloaded", so the one left is the one of the confirmation.
  const again = screen.getAllByRole('button', { name: copy.jury.downloadCode }).at(-1) as HTMLElement
  await userEvent.click(again)
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
