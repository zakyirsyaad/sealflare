import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { GuardianDetail, GuardianSummary, TargetSummary } from '@sealflare/shared/schemas'
import { ApiError } from '../lib/api/client'
import { copy } from '../lib/copy'

const { loadTargets, loadGuardians, loadGuardian } = vi.hoisted(() => ({
  loadTargets: vi.fn(),
  loadGuardians: vi.fn(),
  loadGuardian: vi.fn(),
}))

vi.mock('../lib/api/lists', () => ({ loadTargets, loadGuardians, loadGuardian }))

const { default: ExplorePage } = await import('../app/app/explore/page')
const { default: GuardiansPage } = await import('../app/app/guardians/page')
const { GuardianProfile } = await import('../components/guardians/GuardianProfile')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const OTHER = '0x1111111111111111111111111111111111111111'
const TARGET_ID = `0x${'11'.repeat(32)}`
const OTHER_TARGET_ID = `0x${'22'.repeat(32)}`
const SKILL_SRC = 'gh:owner/swap-helper@abcdef1234567890abcdef1234567890abcdef12:SKILL.md'

function target(overrides: Record<string, unknown> = {}) {
  return TargetSummary.parse({
    targetId: TARGET_ID,
    targetType: 'SMART_CONTRACT',
    label: ADDRESS,
    src: ADDRESS,
    tier: 'CAUTION_FLAGGED',
    safe: 42,
    caution: 1,
    danger: 3,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  })
}

function skill(overrides: Record<string, unknown> = {}) {
  return TargetSummary.parse({
    targetId: OTHER_TARGET_ID,
    targetType: 'AI_SKILL_BUNDLE',
    label: 'swap-helper',
    src: SKILL_SRC,
    tier: 'COMMUNITY_SAFE',
    safe: 9,
    caution: 0,
    danger: 0,
    publisherRole: 'VERIFIED_PUBLISHER',
    bond: '500000000000000000',
    lastVoteAt: '2026-11-25T10:00:00.000Z',
    ...overrides,
  })
}

function guardian(overrides: Record<string, unknown> = {}) {
  return GuardianSummary.parse({
    address: ADDRESS,
    score: 12,
    weight: 2,
    attestations: 3,
    penaltyPending: false,
    ...overrides,
  })
}

/** The stylesheet of the app, so a test can read the rules a narrow screen relies on. */
function globalsCss(): string {
  const candidates = [resolve(process.cwd(), 'app/globals.css'), resolve(process.cwd(), 'apps/web/app/globals.css')]
  for (const candidate of candidates) if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
  throw new Error('The stylesheet of the app was not found.')
}

function renderList(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  loadTargets.mockReset()
  loadGuardians.mockReset()
  loadGuardian.mockReset()
})

describe('the explore list', () => {
  test('Explore lists targets newest first with a seal mark, the three vote counts and the publisher', async () => {
    loadTargets.mockResolvedValue({ items: [target(), skill()], total: 2, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    // The newest vote comes first, even when the answer hands the rows over in another order.
    expect(within(rows[1]!).getByText('swap-helper')).toBeVisible()
    // The seal is a picture beside the word, so the word is what a reader of the screen hears.
    expect(rows[1]!.querySelector('.sf-seal')).not.toBeNull()
    expect(within(rows[1]!).getByText('Community safe')).toBeVisible()
    expect(within(rows[1]!).getByText('9')).toBeVisible()
    // The caution and the danger counts are both zero, so both cells are there.
    expect(within(rows[1]!).getAllByText('0')).toHaveLength(2)
    expect(within(rows[1]!).getByText('Verified publisher, 0.5 BNB bond')).toBeVisible()
    expect(within(rows[2]!).getByText('0x60b9…022f')).toBeVisible()
    expect(within(rows[2]!).getByText('Not claimed')).toBeVisible()
  })

  test('filters by kind and by verdict, and the filter is in the URL', async () => {
    loadTargets.mockResolvedValue({ items: [], total: 0, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({ kind: 'AI_SKILL_BUNDLE', verdict: 'SAFE' }) }))
    await waitFor(() =>
      expect(loadTargets).toHaveBeenCalledWith(expect.objectContaining({ type: 'AI_SKILL_BUNDLE', verdict: 'SAFE' })),
    )
    const contracts = screen.getByRole('link', { name: copy.explore.kindContracts })
    expect(contracts).toHaveAttribute('href', '/app/explore?kind=SMART_CONTRACT&verdict=SAFE')
    const anyVerdict = screen.getByRole('link', { name: copy.explore.verdictAny })
    expect(anyVerdict).toHaveAttribute('href', '/app/explore?kind=AI_SKILL_BUNDLE')
    expect(screen.getByRole('link', { name: copy.explore.kindSkills })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: copy.explore.verdictSafe })).toHaveAttribute('aria-current', 'true')
  })

  test('the three vote counts are always shown; there is no single score column', async () => {
    loadTargets.mockResolvedValue({ items: [target()], total: 1, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader').map(header => header.textContent)
    expect(headers).toEqual([
      copy.explore.columns.target,
      copy.explore.columns.verdict,
      copy.explore.columns.safe,
      copy.explore.columns.caution,
      copy.explore.columns.danger,
      copy.explore.columns.publisher,
      copy.explore.columns.lastVote,
    ])
    expect(headers).not.toContain('Score')
    const row = within(table).getAllByRole('row')[1]!
    expect(within(row).getByText('42')).toBeVisible()
    expect(within(row).getByText('1')).toBeVisible()
    expect(within(row).getByText('3')).toBeVisible()
  })

  test('the way through the pages counts the pages and keeps the filter', async () => {
    loadTargets.mockResolvedValue({ items: [target()], total: 40, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({ kind: 'SMART_CONTRACT' }) }))
    expect(await screen.findByText(copy.explore.page.replace('{page}', '1').replace('{pages}', '2'))).toBeVisible()
    // The next page is the same list, so it carries the filter with it.
    expect(screen.getByRole('link', { name: copy.explore.next })).toHaveAttribute('href', '/app/explore?kind=SMART_CONTRACT&page=2')
  })

  test('a registry too large for one filter asks for a narrower filter', async () => {
    loadTargets.mockRejectedValue(new ApiError('BAD_REQUEST', 'The registry holds more targets than one filter can read.'))
    renderList(await ExplorePage({ searchParams: Promise.resolve({ verdict: 'SAFE' }) }))
    expect(await screen.findByText(copy.explore.tooMany)).toBeVisible()
  })
})

describe('the guardian list', () => {
  test('Guardians ranks by score and marks "Penalty pending"', async () => {
    loadGuardians.mockResolvedValue({
      items: [
        guardian({ address: OTHER, score: 3, attestations: 9 }),
        guardian({ address: ADDRESS, score: 30, weight: 3, attestations: 2, penaltyPending: true }),
      ],
      total: 2,
      finalizedBlock: '12345',
    })
    renderList(await GuardiansPage({ searchParams: Promise.resolve({}) }))
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    // The higher score comes first, even when the answer hands the rows over in another order.
    expect(within(rows[1]!).getByText('0x60b9…022f')).toBeVisible()
    expect(within(rows[1]!).getByText('30')).toBeVisible()
    expect(within(rows[1]!).getByText(copy.dispute.penaltyPending)).toBeVisible()
    expect(within(rows[2]!).getByText('0x1111…1111')).toBeVisible()
  })

  test('an empty guardian list says why it is empty', async () => {
    loadGuardians.mockResolvedValue({ items: [], total: 0, finalizedBlock: '12345' })
    renderList(await GuardiansPage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByText(copy.guardians.empty)).toBeVisible()
  })
})

describe('the guardian profile', () => {
  test('a profile shows score, weight and history', async () => {
    loadGuardian.mockResolvedValue({
      item: GuardianDetail.parse({
        ...guardian({ score: 30, weight: 3, attestations: 2 }),
        createdAtBlock: '42',
        history: [
          {
            kind: 'attestation',
            targetId: TARGET_ID,
            label: 'A target',
            result: 'SAFE',
            xp: 2,
            at: '2026-11-25T10:00:00.000Z',
          },
        ],
      }),
      finalizedBlock: '12345',
    })
    renderList(<GuardianProfile address={ADDRESS} />)
    expect(await screen.findByText('30')).toBeVisible()
    expect(screen.getByText('Vote weight 3 of 5')).toBeVisible()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(within(rows[1]!).getByText('Attestation')).toBeVisible()
    expect(within(rows[1]!).getByText('A target')).toBeVisible()
    expect(within(rows[1]!).getByText('+2')).toBeVisible()
  })

  test('a profile names the block it was read at and what a row that earns no XP says', async () => {
    loadGuardian.mockResolvedValue({
      item: GuardianDetail.parse({
        ...guardian(),
        createdAtBlock: '42',
        history: [
          {
            kind: 'attestation',
            targetId: TARGET_ID,
            label: 'A target',
            result: 'SAFE',
            xp: null,
            at: '2026-11-25T10:00:00.000Z',
          },
        ],
      }),
      finalizedBlock: '12345',
    })
    renderList(<GuardianProfile address={ADDRESS} />)
    // A row that earns no XP says so, and it does not borrow the word of a pending penalty.
    expect(await screen.findByText(copy.guardians.noXp)).toBeVisible()
    expect(screen.getByText(copy.guardians.indexedTo.replace('{block}', '12345'))).toBeVisible()
    expect(screen.getByText(copy.guardians.historyCountOne.replace('{count}', '1'))).toBeVisible()
  })
})

describe('the states of a guardian profile', () => {
  test('a profile that is loading says so', async () => {
    loadGuardian.mockReturnValue(new Promise(() => {}))
    renderList(<GuardianProfile address={ADDRESS} />)
    expect(await screen.findByRole('status')).toBeVisible()
  })

  test('a profile of a Guardian that does not exist says so', async () => {
    loadGuardian.mockRejectedValue(new ApiError('NOT_FOUND', 'There is no such Guardian.'))
    renderList(<GuardianProfile address={ADDRESS} />)
    expect(await screen.findByText(copy.guardians.notFound)).toBeVisible()
  })

  test('an address that is not an address is a Guardian that does not exist', async () => {
    renderList(<GuardianProfile address="not-an-address" />)
    expect(await screen.findByText(copy.guardians.notFound)).toBeVisible()
    // The address never reaches the API, because it is not an address.
    expect(loadGuardian).not.toHaveBeenCalled()
  })

  test('a profile that fails says what failed and offers a retry', async () => {
    loadGuardian.mockRejectedValue(new ApiError('INTERNAL', 'This Guardian could not be loaded.'))
    renderList(<GuardianProfile address={ADDRESS} />)
    expect(await screen.findByText(copy.guardians.failedProfile)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.common.retry })).toBeEnabled()
  })
})

describe('the states of every list', () => {
  test('every list has empty, loading and failed states', async () => {
    // A list that is still loading says so, and it does not show an empty list meanwhile.
    loadTargets.mockReturnValue(new Promise(() => {}))
    loadGuardians.mockReturnValue(new Promise(() => {}))
    const explore = renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByText(copy.explore.empty)).not.toBeInTheDocument()
    explore.unmount()
    renderList(await GuardiansPage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByRole('status')).toBeVisible()
    expect(screen.queryByText(copy.guardians.empty)).not.toBeInTheDocument()
  })

  test('an empty list says why it is empty and offers a way out', async () => {
    loadTargets.mockResolvedValue({ items: [], total: 0, finalizedBlock: '12345' })
    loadGuardians.mockResolvedValue({ items: [], total: 0, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByText(copy.explore.empty)).toBeVisible()
    // Without a filter the way out is a scan, with a filter it is the filter itself.
    expect(screen.getByRole('link', { name: copy.explore.scanTarget })).toBeVisible()
  })

  test('an empty list with a filter offers to clear the filter', async () => {
    loadTargets.mockResolvedValue({ items: [], total: 0, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({ kind: 'SMART_CONTRACT' }) }))
    expect(await screen.findByText(copy.explore.empty)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.explore.clearFilter })).toBeVisible()
  })

  test('a failed list says what failed and offers a retry', async () => {
    loadTargets.mockRejectedValue(new ApiError('INTERNAL', 'The indexed targets cannot be read.'))
    loadGuardians.mockRejectedValue(new ApiError('INTERNAL', 'The indexed guardians cannot be read.'))
    renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByText(copy.explore.failed)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.common.retry })).toBeEnabled()
  })

  test('a failed guardian list says what failed and offers a retry', async () => {
    loadGuardians.mockRejectedValue(new ApiError('INTERNAL', 'The indexed guardians cannot be read.'))
    renderList(await GuardiansPage({ searchParams: Promise.resolve({}) }))
    expect(await screen.findByText(copy.guardians.failed)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.common.retry })).toBeEnabled()
  })
})

describe('the narrow screen', () => {
  test('at 375 px each row is a card and nothing overflows', async () => {
    loadTargets.mockResolvedValue({ items: [target()], total: 1, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({}) }))
    const table = await screen.findByRole('table')
    const cells = within(table).getAllByRole('cell')
    expect(cells.length).toBeGreaterThan(0)
    // Every cell names its column, so a row that becomes a card still says what it holds.
    for (const cell of cells) expect(cell).toHaveAttribute('data-label')
    const css = globalsCss()
    const narrow = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(narrow).toContain('.sf-table tr')
    expect(narrow).toContain('display: block')
    // The filters scroll inside the screen, so a row of them never widens the page.
    expect(narrow).toContain('.sf-seg')
    expect(narrow).toContain('overflow-x: auto')
    // Nothing may be wider than the screen, so the table never carries a fixed width.
    expect(css).not.toMatch(/\.sf-table[^{]*\{[^}]*min-width/)
  })
})
