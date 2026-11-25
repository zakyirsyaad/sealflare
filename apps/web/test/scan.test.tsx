import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ScanPanel } from '../components/target/ScanPanel'
import { copy } from '../lib/copy'
import { readFileSync } from 'node:fs'
import { CONTRACT_CHECK_IDS } from '@sealflare/shared/schemas'
import { CONSTANTS } from '@sealflare/shared/rules'
import { ApiError } from '../lib/api/client'
import { ScanError } from '../components/target/ScanError'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const REPORT = {
  schemaVersion: 1,
  targetType: 'SMART_CONTRACT',
  targetId: '0x2207d8fe3c025a72d53ae6bc382300fad26674f30e0eebb2026fe35545f4ece2',
  source: { kind: 'contract', address: ADDRESS, codehash: `0x${'11'.repeat(32)}`, blockNumber: '52000000' },
  scannedAt: '2026-11-25T03:00:00.000Z',
  checks: CONTRACT_CHECK_IDS.map(id => ({ id, status: 'passed' })),
  findings: [],
  flags: 0,
  suggestedVerdict: 'SAFE',
}

function envelope(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response)
}

function fetchMock(handler: (url: string, init?: RequestInit) => unknown) {
  return vi.fn((url: string, init?: RequestInit) => {
    const body = handler(url, init)
    return body instanceof Promise ? body : envelope(body)
  })
}

async function type(value: string) {
  const user = userEvent.setup()
  const field = screen.getByLabelText(copy.scan.fieldLabel)
  await user.clear(field)
  await user.type(field, value)
  return user
}

describe('the scan screen', () => {
  beforeEach(() => {
    push.mockReset()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('pasting an address and pressing Enter starts a contract scan', async () => {
    const fetch = fetchMock(() => ({ success: true, data: REPORT }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type(ADDRESS)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/scan/contract')
    expect(JSON.parse(String(init.body))).toEqual({ address: ADDRESS })
  })

  test('pasting a repository link starts a skill scan', async () => {
    const fetch = fetchMock(() => ({ success: true, data: { ...REPORT, targetType: 'AI_SKILL_BUNDLE' } }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type('https://github.com/owner/repo')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/scan/skill')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://github.com/owner/repo' })
  })

  test('checks tick off one by one while scanning', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', fetchMock(() => new Promise(() => {})))
      render(<ScanPanel />)
      fireEvent.change(screen.getByLabelText(copy.scan.fieldLabel), { target: { value: ADDRESS } })
      fireEvent.submit(screen.getByRole('button', { name: copy.scan.action }).closest('form')!)
      const list = screen.getByRole('list', { name: copy.scan.checklist })
      const done = () => within(list).getAllByRole('listitem').filter(item => item.dataset.status === 'done').length
      expect(done()).toBe(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })
      expect(done()).toBe(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })
      expect(done()).toBe(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(done()).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a finished scan navigates to the target page with the src query', async () => {
    vi.stubGlobal('fetch', fetchMock(() => ({ success: true, data: REPORT })))
    render(<ScanPanel />)
    const user = await type(ADDRESS)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/t/${REPORT.targetId}?src=${ADDRESS}`))
  })

  test.each([
    ['INPUT_NOT_RECOGNIZED', 'That is not a contract address or a repository link.'],
    ['NO_CODE_AT_ADDRESS', 'No contract is deployed at this address on BNB Chain.'],
    ['REPO_NOT_PUBLIC', 'This repository is not public.'],
    ['NO_SKILL_FOUND', 'No skill was found in this repository.'],
    ['BUNDLE_TOO_LARGE', 'This skill is too large to scan.'],
    ['RPC_UNAVAILABLE', 'BNB Chain could not be reached. No verdict was produced.'],
  ])('%s shows "%s"', async (code, message) => {
    vi.stubGlobal('fetch', fetchMock(() => ({ success: false, error: { code, message: 'server text' } })))
    render(<ScanPanel />)
    const user = await type(ADDRESS)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
  })

  test('RATE_LIMITED shows the minutes to wait', async () => {
    vi.stubGlobal('fetch', fetchMock(() => ({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many scans.', details: { retryAfterSeconds: 180 } },
    })))
    render(<ScanPanel />)
    const user = await type(ADDRESS)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText('Too many scans from your network. Try again in 3 minutes.')).toBeInTheDocument())
  })

  test('MULTIPLE_SKILL_FOLDERS lists the folders and scans the one chosen', async () => {
    const fetch = fetchMock((url: string) => {
      const body = JSON.parse(String((fetch.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body ?? '{}'))
      if (body.path === undefined) {
        return { success: false, error: { code: 'MULTIPLE_SKILL_FOLDERS', message: 'Choose a skill folder.', details: { folders: ['skills/alpha', 'skills/beta'] } } }
      }
      return { success: true, data: REPORT }
    })
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type('https://github.com/owner/repo')
    await user.keyboard('{Enter}')
    const folders = await screen.findByRole('list', { name: copy.scan.folders })
    expect(within(folders).getAllByRole('listitem').map(item => item.textContent)).toEqual(['skills/alpha', 'skills/beta'])
    await user.click(within(folders).getByRole('button', { name: 'skills/beta' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const body = JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body))
    expect(body.path).toBe('skills/beta')
  })

  test('a query from the landing page starts the scan immediately', async () => {
    const fetch = fetchMock(() => ({ success: true, data: REPORT }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel initialQuery={ADDRESS} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect((fetch.mock.calls[0] as [string, RequestInit])[0]).toBe('/api/scan/contract')
  })

  test('the field is labelled and usable with the keyboard alone', async () => {
    const fetch = fetchMock(() => ({ success: true, data: REPORT }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const field = screen.getByLabelText(copy.scan.fieldLabel)
    field.focus()
    expect(field).toHaveFocus()
    const user = userEvent.setup()
    await user.keyboard(ADDRESS)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  test.each([
    ['a commit-pinned link', `https://github.com/owner/repo/tree/${'b'.repeat(40)}/skills/alpha`, `https://github.com/owner/repo/tree/${'b'.repeat(40)}`, 'skills/alpha'],
    ['an explicit main link', 'https://github.com/owner/repo/tree/main/skills/alpha', 'https://github.com/owner/repo/tree/main', 'skills/alpha'],
    ['a compact gh: reference', `gh:owner/repo@${'c'.repeat(40)}:skills/alpha`, `https://github.com/owner/repo/tree/${'c'.repeat(40)}`, 'skills/alpha'],
  ])('%s keeps its commit or branch on the way to the server', async (_name, typed, url, path) => {
    const fetch = fetchMock(() => ({ success: true, data: { ...REPORT, targetType: 'AI_SKILL_BUNDLE' } }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type(typed)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.url).toBe(url)
    expect(body.path).toBe(path)
  })

  test('choosing a folder keeps the pinned commit of the link that listed the folders', async () => {
    const sha = 'd'.repeat(40)
    const fetch = fetchMock(() => {
      const last = JSON.parse(String((fetch.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.body ?? '{}'))
      return last.path === undefined
        ? { success: false, error: { code: 'MULTIPLE_SKILL_FOLDERS', message: 'Choose.', details: { folders: ['skills/alpha'] } } }
        : { success: true, data: REPORT }
    })
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type(`https://github.com/owner/repo/tree/${sha}`)
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('button', { name: 'skills/alpha' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const second = JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body))
    expect(second).toEqual({ url: `https://github.com/owner/repo/tree/${sha}`, path: 'skills/alpha' })
  })

  test('a timer tick is never drawn in the positive colour, because it is not a result', () => {
    const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8')
    const rule = css.split('\n').find(line => line.includes("data-status='passed'") && line.includes('--positive')) ?? ''
    expect(rule).not.toContain("data-status='done'")
    expect(css).toMatch(/data-status='done'\][^{]*\{[^}]*--muted-foreground/)
  })
})

describe('the scan error', () => {
  const rate = (details?: unknown) => new ApiError('RATE_LIMITED', 'Too many scans.', details)

  test.each([
    [30, 'Too many scans from your network. Try again in 1 minute.'],
    [60, 'Too many scans from your network. Try again in 1 minute.'],
    [61, 'Too many scans from your network. Try again in 2 minutes.'],
    [180, 'Too many scans from your network. Try again in 3 minutes.'],
  ])('a wait of %i seconds reads "%s"', (seconds, sentence) => {
    render(<ScanError error={rate({ retryAfterSeconds: seconds })} />)
    expect(screen.getByText(sentence)).toBeInTheDocument()
  })

  test.each([[undefined], [{}], [{ retryAfterSeconds: 'soon' }], [{ retryAfterSeconds: 0 }], [{ retryAfterSeconds: -5 }]])(
    'with no usable wait from the server (%j) no number is invented', details => {
      render(<ScanError error={rate(details)} />)
      expect(screen.getByText('Too many scans from your network. Try again in a few minutes.')).toBeInTheDocument()
    })

  test('a skill that is too large states the limit from the shared constants', () => {
    render(<ScanError error={new ApiError('BUNDLE_TOO_LARGE', 'x')} />)
    expect(screen.getByText('This skill is too large to scan.')).toBeInTheDocument()
    const mib = CONSTANTS.MAX_BUNDLE_BYTES / 1_048_576
    expect(screen.getByText(`The limit is ${mib} MiB and ${CONSTANTS.MAX_BUNDLE_FILES} files.`)).toBeInTheDocument()
  })

  test.each([
    ['NO_SKILL_FOUND', 'Paste the link to the folder that holds SKILL.md.'],
    ['INPUT_NOT_RECOGNIZED', 'Try 0x… for a contract, or https://github.com/owner/repo for a skill.'],
    ['NO_CODE_AT_ADDRESS', 'Check the address and the network it is deployed on.'],
    ['REPO_NOT_PUBLIC', 'Paste the link to a public repository.'],
  ])('%s says what to do next', (code, hint) => {
    render(<ScanError error={new ApiError(code, 'x')} />)
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  test('an unreachable chain offers a retry that runs the same scan again', async () => {
    const onRetry = vi.fn()
    render(<ScanError error={new ApiError('RPC_UNAVAILABLE', 'x')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('only an unreachable chain gets a retry button', () => {
    render(<ScanError error={new ApiError('NO_SKILL_FOUND', 'x')} onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: copy.common.retry })).toBeNull()
  })

  test('the screen retries the same input after RPC_UNAVAILABLE', async () => {
    let calls = 0
    const fetch = fetchMock(() => (++calls === 1 ? { success: false, error: { code: 'RPC_UNAVAILABLE', message: 'x' } } : { success: true, data: REPORT }))
    vi.stubGlobal('fetch', fetch)
    render(<ScanPanel />)
    const user = await type(ADDRESS)
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('button', { name: copy.common.retry }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
