import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
const TARGET_ID = `0x${'11'.repeat(32)}`

function target(): TargetSummary {
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
  })
}

function guardian(): GuardianSummary {
  return GuardianSummary.parse({
    address: ADDRESS,
    score: 12,
    weight: 2,
    attestations: 3,
    penaltyPending: false,
  })
}

function renderList(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) }
}

beforeEach(() => {
  loadTargets.mockReset()
  loadGuardians.mockReset()
  loadGuardian.mockReset()
})

describe('a page past the end of a list', () => {
  test('a page past the end of the target list says so and offers the first page', async () => {
    // The list holds rows, but not on this page.
    loadTargets.mockResolvedValue({ items: [], total: 40, finalizedBlock: '12345' })
    renderList(await ExplorePage({ searchParams: Promise.resolve({ page: '9' }) }))
    expect(await screen.findByText(copy.explore.noSuchPage)).toBeVisible()
    // The way out is the first page, not a scan: there are targets in the registry.
    expect(screen.getByRole('link', { name: copy.explore.backToStart })).toHaveAttribute('href', '/app/explore')
    expect(screen.queryByText(copy.explore.empty)).not.toBeInTheDocument()
  })

  test('a page past the end of the guardian list says so and offers the first page', async () => {
    loadGuardians.mockResolvedValue({ items: [], total: 5, finalizedBlock: '12345' })
    renderList(await GuardiansPage({ searchParams: Promise.resolve({ page: '9' }) }))
    expect(await screen.findByText(copy.guardians.noSuchPage)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.guardians.backToStart })).toHaveAttribute('href', '/app/guardians')
    expect(screen.queryByText(copy.guardians.empty)).not.toBeInTheDocument()
  })
})

describe('the states of the guardian screens', () => {
  test('a guardian list that fails on a later read does not keep showing the old rows', async () => {
    loadGuardians.mockResolvedValue({ items: [guardian()], total: 1, finalizedBlock: '12345' })
    const { client } = renderList(await GuardiansPage({ searchParams: Promise.resolve({}) }))
    await screen.findByRole('table')
    // The rows are on the screen and the next read fails.
    loadGuardians.mockRejectedValue(new ApiError('INTERNAL', 'The indexed guardians cannot be read.'))
    await client.invalidateQueries()
    // The failure is shown instead of the rows, because a list that hides a failure would look
    // like a registry without Guardians.
    expect(await screen.findByText(copy.guardians.failed)).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('a guardian that never voted says so instead of showing an empty table', async () => {
    loadGuardian.mockResolvedValue({
      item: GuardianDetail.parse({ ...guardian(), createdAtBlock: '42', history: [] }),
      finalizedBlock: '12345',
    })
    renderList(<GuardianProfile address={ADDRESS} />)
    expect(await screen.findByText(copy.guardians.emptyHistory)).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
