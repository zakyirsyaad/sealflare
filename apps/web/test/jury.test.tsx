import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UserRejectedRequestError } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { JoinPanel } from '../components/jury/JoinPanel'
import { copy } from '../lib/copy'
import { commitHashFor, loadRevealCode, parseRevealCode } from '../lib/revealCode'
import { resetDispute, state, wagmi } from './dispute.mocks'
import { COURT, ME, NOW, txHash } from './dispute.fixtures'

const COMMIT_ENDS = new Date(NOW.getTime() + 4 * 3_600_000).toISOString()
const REVEAL_ENDS = new Date(NOW.getTime() + 16 * 3_600_000).toISOString()

const clipboard = { writeText: vi.fn() }
const click = vi.fn()

function join_(overrides: Partial<Parameters<typeof JoinPanel>[0]> = {}) {
  return render(
    <JoinPanel challengeId="12" commitEndsAt={COMMIT_ENDS} revealEndsAt={REVEAL_ENDS} onClose={() => {}} {...overrides} />,
  )
}

const radio = (name: 'Uphold' | 'Reject') => screen.getByRole('radio', { name: new RegExp(`^${name}`) })

async function toSummary(vote: 'Uphold' | 'Reject' = 'Uphold') {
  await userEvent.click(radio(vote))
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
}

async function toCode(vote: 'Uphold' | 'Reject' = 'Uphold') {
  await toSummary(vote)
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
}

/** The reveal code as the juror sees it. */
const shownCode = () => (screen.getByLabelText(copy.jury.codeLabel) as HTMLInputElement).value
const commitButton = () => screen.getByRole('button', { name: copy.jury.commit })

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

test('an eligible juror is told so and can choose a vote, with nothing chosen for them', () => {
  join_()
  expect(screen.getByText(copy.jurorStatus[0])).toBeInTheDocument()
  expect(radio('Uphold')).toHaveAttribute('aria-checked', 'false')
  expect(radio('Reject')).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByRole('button', { name: copy.jury.continue })).toBeDisabled()
  expect(screen.getByText(copy.jury.step[0])).toBeInTheDocument()
})

test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('each ineligible status shows its own reason: status %i', async status => {
  wagmi.reads.current.jurorStatus = status
  join_()
  expect(screen.getByText(copy.jurorStatus[status] as string)).toBeInTheDocument()
  for (const other of copy.jurorStatus.keys()) {
    if (other !== status) expect(screen.queryByText(copy.jurorStatus[other] as string)).toBeNull()
  }
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.queryByRole('button', { name: copy.jury.continue })).toBeNull()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('the nine reasons are nine different sentences', () => {
  expect(new Set(copy.jurorStatus).size).toBe(copy.jurorStatus.length)
})

test('until the Court answers, nothing can be committed', () => {
  wagmi.reads.current.jurorStatus = undefined
  join_()
  expect(screen.getByText(copy.jury.checking)).toBeInTheDocument()
  expect(screen.queryByRole('radio')).toBeNull()
})

test('without a wallet, on the wrong network or without an Agent ID the panel shows that branch and no vote', () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  const first = join_()
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
  expect(screen.queryByRole('radio')).toBeNull()
  first.unmount()
  state.value = { kind: 'no-agent-id', address: ME, isLoading: false, isError: false, recheck: () => {} }
  join_()
  expect(screen.getByText(copy.wallet.agentRequired)).toBeInTheDocument()
})

test('the summary names the 0.005 BNB stake, the reveal schedule and both ways to lose the stake', async () => {
  join_()
  await toSummary()
  expect(screen.getByText('0.005 BNB, held until the dispute ends')).toBeInTheDocument()
  expect(screen.getByText('Opens 2026-12-01 14:00 UTC and closes 2026-12-02 02:00 UTC')).toBeInTheDocument()
  expect(screen.getByText(copy.jury.loseNoReveal)).toBeInTheDocument()
  expect(screen.getByText(copy.jury.loseMinority)).toBeInTheDocument()
  expect(screen.getByText(copy.jury.winNote.replace('{xp}', '3'))).toBeInTheDocument()
  expect(screen.getByText(copy.jury.step[1])).toBeInTheDocument()
})

test('the commit button stays disabled until the reveal code is copied or downloaded', async () => {
  join_()
  await toCode()
  expect(commitButton()).toBeDisabled()
  expect(screen.getByText(copy.jury.codeRequired)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  expect(clipboard.writeText).toHaveBeenCalledWith(shownCode())
  await waitFor(() => expect(commitButton()).toBeEnabled())
})

test('downloading the code is enough too, and the file holds the code and nothing else', async () => {
  join_()
  await toCode()
  expect(commitButton()).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.downloadCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  expect(click).toHaveBeenCalledWith('sealflare-reveal-code-12.txt', 'blob:sealflare-test')
  const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Blob
  const text = await new Promise<string>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
  expect(text.trim()).toBe(shownCode())
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sealflare-test')
})

test('a browser that will not copy does not count as copied', async () => {
  clipboard.writeText.mockRejectedValue(new Error('denied'))
  join_()
  await toCode()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  expect(await screen.findByText(copy.jury.copyFailed)).toBeInTheDocument()
  expect(commitButton()).toBeDisabled()
})

test('the code names the vote that was chosen, and a changed vote makes a new code', async () => {
  join_()
  await toCode('Uphold')
  const first = shownCode()
  expect(parseRevealCode(first)).toMatchObject({ challengeId: 12n, uphold: true })
  await userEvent.click(screen.getByRole('button', { name: copy.attest.back }))
  await userEvent.click(screen.getByRole('button', { name: copy.attest.back }))
  await userEvent.click(radio('Reject'))
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
  await userEvent.click(screen.getByRole('button', { name: copy.jury.continue }))
  const second = shownCode()
  expect(parseRevealCode(second)).toMatchObject({ challengeId: 12n, uphold: false })
  expect(second).not.toBe(first)
})

test('the code stays the same while the juror stays on the step', async () => {
  join_()
  await toCode()
  const before = shownCode()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  expect(shownCode()).toBe(before)
})

async function commit(vote: 'Uphold' | 'Reject' = 'Uphold') {
  await toCode(vote)
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  await waitFor(() => expect(commitButton()).toBeEnabled())
  const code = shownCode()
  await userEvent.click(commitButton())
  return code
}

test('the stake sent equals JURY_STAKE exactly, to the Court, from the wallet of the juror', async () => {
  join_()
  const code = await commit()
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as {
    functionName: string
    value: bigint
    address: string
    account: string
    chainId: number
    args: readonly unknown[]
  }
  expect(written.functionName).toBe('commitVote')
  expect(written.value).toBe(CONSTANTS.JURY_STAKE)
  expect(written.address).toBe(COURT)
  expect(written.account).toBe(ME)
  expect(written.chainId).toBe(56)
  expect(written.args).toEqual([12n, commitHashFor(code, ME)])
})

test('the commit hash is bound to this juror: another juror would need another hash', async () => {
  join_()
  const code = await commit()
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as { args: readonly unknown[] }
  expect(written.args[1]).not.toBe(commitHashFor(code, '0x7100000000000000000000000000000000000001'))
})

test('no signature is asked for anywhere on this path', async () => {
  join_()
  await commit()
  expect(wagmi.signMessageAsync).not.toHaveBeenCalled()
  expect(wagmi.signTypedDataAsync).not.toHaveBeenCalled()
})

test('no source file of this path can ask for a signature', () => {
  const root = join(__dirname, '..')
  const files = [
    join(root, 'lib', 'revealCode.ts'),
    ...readdirSync(join(root, 'components', 'jury')).map(name => join(root, 'components', 'jury', name)),
  ]
  expect(files.length).toBeGreaterThan(3)
  for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/signMessage|signTypedData|personal_sign|eth_sign/)
})

test('the code is kept in local storage before the transaction is asked for, so it cannot be lost on the way', async () => {
  let keptWhenAsked: string | null = null
  wagmi.writeContractAsync.mockImplementation(async () => {
    keptWhenAsked = loadRevealCode(12n, ME)
    return txHash
  })
  join_()
  const code = await commit()
  expect(keptWhenAsked).toBe(code)
})

test('a browser that will not keep the code says so, and the commit still goes ahead with the saved copy', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  join_()
  await commit()
  expect(await screen.findByText(copy.jury.localFailed)).toBeInTheDocument()
  expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(1)
})

test('refusing the transaction in the wallet returns to the code with no error and the code kept', async () => {
  wagmi.writeContractAsync.mockRejectedValue(new UserRejectedRequestError(new Error('The user rejected the request.')))
  join_()
  await toCode()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyCode }))
  const before = shownCode()
  await userEvent.click(commitButton())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(commitButton()).toBeEnabled()
  expect(shownCode()).toBe(before)
})

test('the commit confirmation says there is no reminder outside the app and shows a copyable reveal time', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  join_()
  await commit()
  expect(await screen.findByText(copy.jury.committedTitle)).toBeInTheDocument()
  expect(screen.getByText(copy.jury.noReminder)).toBeInTheDocument()
  const window_ = 'Reveal window: 2026-12-01 14:00 UTC to 2026-12-02 02:00 UTC'
  expect(screen.getByText(window_)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.jury.copyTime }))
  expect(clipboard.writeText).toHaveBeenLastCalledWith(window_)
  expect(screen.getByText(copy.common.waitingFinality)).toBeInTheDocument()
})

test('the code is kept in local storage so a reveal from the same device is one click', async () => {
  join_()
  const code = await commit()
  expect(loadRevealCode(12n, ME)).toBe(code)
})

test('no code is printed to a log or put in a URL', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}))
  const before = window.location.href
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  join_()
  const code = await commit()
  const salt = code.slice(-64)
  for (const spy of spies) {
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(salt)
  }
  expect(window.location.href).toBe(before)
  expect(window.location.href).not.toContain(salt)
  for (const element of document.querySelectorAll('[href], [src], form')) {
    expect(element.getAttribute('href') ?? element.getAttribute('src') ?? element.getAttribute('action') ?? '').not.toContain(salt)
  }
  for (const call of click.mock.calls) expect(String(call[1])).not.toContain(salt)
})

test('a failed commit shows the reason of the contract and offers a retry that keeps the same code', async () => {
  wagmi.writeContractAsync.mockRejectedValueOnce(
    Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError', data: { errorName: 'NotEligibleJuror', args: [6] } }),
  )
  join_()
  const code = await commit()
  expect(await screen.findByText(copy.jurorStatus[6] as string)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2))
  expect((wagmi.writeContractAsync.mock.calls[1]?.[0] as { args: readonly unknown[] }).args[1]).toBe(commitHashFor(code, ME))
  expect(screen.queryByText(copy.jury.committedTitle)).toBeNull()
})
