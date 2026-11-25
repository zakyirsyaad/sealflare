import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ScanPanel } from '../components/target/ScanPanel'
import { copy } from '../lib/copy'
import { CONTRACT_CHECK_IDS } from '@sealflare/shared/schemas'

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
})
