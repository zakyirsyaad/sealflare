import { beforeEach, expect, test, vi } from 'vitest'
import { targetIdOfContract } from '@sealflare/shared/rules'

const internal = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../server/internal', async () => {
  const actual = await vi.importActual<typeof import('../server/internal')>('../server/internal')
  return { ...actual, internalGet: internal.get }
})

const chain = vi.hoisted(() => ({ target: vi.fn() }))
vi.mock('../server/chain', async () => {
  const actual = await vi.importActual<typeof import('../server/chain')>('../server/chain')
  return { ...actual, getChainReader: () => ({ target: chain.target }) }
})

import { InternalServiceError } from '../server/internal'
import { loadChallengesOf, loadDispute, loadDisputes } from '../server/disputes'
import { detail, summary } from './dispute.fixtures'

const ID = targetIdOfContract('0x60b9262456de011f7d15a54cdd8c48baaa8b022f')
const PUBLISHER = '0x5200000000000000000000000000000000000c19'

function answer(data: unknown, meta: Record<string, unknown> = { finalizedBlock: '123' }) {
  return { data, meta }
}

beforeEach(() => {
  vi.clearAllMocks()
  chain.target.mockResolvedValue({ publisher: PUBLISHER, publisherRole: 'VERIFIED_PUBLISHER' })
})

test('a dispute is read from the internal service with the publisher and the role of the chain', async () => {
  internal.get.mockResolvedValue(answer(detail()))
  const data = await loadDispute('12')
  expect(internal.get).toHaveBeenCalledWith('/challenges/12')
  expect(data.failed).toBe(false)
  expect(data.detail?.id).toBe('12')
  expect(data.publisherRole).toBe('VERIFIED_PUBLISHER')
  expect(data.publisher).toBe(PUBLISHER)
  expect(chain.target).toHaveBeenCalledWith(detail().targetId)
})

test('a dispute the service does not have is not found, and the chain is not read', async () => {
  internal.get.mockRejectedValue(new InternalServiceError('NOT_FOUND', 'There is no such dispute.'))
  const data = await loadDispute('99')
  expect(data).toMatchObject({ detail: null, failed: false })
  expect(chain.target).not.toHaveBeenCalled()
})

test.each([['abc'], ['-1'], ['1.5'], ['']])('the id %s is not read at all', async id => {
  const data = await loadDispute(id)
  expect(data).toMatchObject({ detail: null, failed: false })
  expect(internal.get).not.toHaveBeenCalled()
})

test('a service that is down is a failure and never a missing dispute', async () => {
  internal.get.mockRejectedValue(new InternalServiceError('INTERNAL', 'The internal service could not be reached.'))
  const data = await loadDispute('12')
  expect(data).toMatchObject({ detail: null, failed: true })
})

test('a row that does not fit the frozen schema is a failure, never a made up dispute', async () => {
  internal.get.mockResolvedValue(answer({ ...detail(), flags: 'nope' }))
  expect(await loadDispute('12')).toMatchObject({ detail: null, failed: true })
})

test('the directions of the votes are taken away while the index says the commit phase', async () => {
  const raw = {
    ...detail({ phase: 'COMMIT' }),
    jurors: [{ address: PUBLISHER, weight: 2, revealed: true, uphold: true }],
  }
  internal.get.mockResolvedValue(answer(raw))
  const data = await loadDispute('12')
  expect(data.failed).toBe(false)
  expect(data.detail?.jurors[0]?.uphold).toBeNull()
})

test('a chain that cannot be read leaves the publisher unknown, which is not the same as no publisher', async () => {
  internal.get.mockResolvedValue(answer(detail()))
  chain.target.mockRejectedValue(new Error('rpc down'))
  const data = await loadDispute('12')
  expect(data.failed).toBe(false)
  expect(data.detail?.id).toBe('12')
  expect(data.publisherRole).toBeNull()
  expect(data.publisher).toBeNull()
})

test('a target the registry does not know has no publisher', async () => {
  internal.get.mockResolvedValue(answer(detail()))
  chain.target.mockResolvedValue(null)
  const data = await loadDispute('12')
  expect(data.publisherRole).toBe('NONE')
  expect(data.publisher).toBeNull()
})

test('the zero address of the registry is no publisher', async () => {
  internal.get.mockResolvedValue(answer(detail()))
  chain.target.mockResolvedValue({ publisher: '0x0000000000000000000000000000000000000000', publisherRole: 'NONE' })
  const data = await loadDispute('12')
  expect(data.publisherRole).toBe('NONE')
  expect(data.publisher).toBeNull()
})

test('the list of disputes is read page by page, and a failure is never an empty list', async () => {
  internal.get.mockResolvedValue(answer({ items: [summary()] }, { finalizedBlock: '123', page: { total: 1, page: 1, limit: 20 } }))
  const data = await loadDisputes()
  expect(internal.get).toHaveBeenCalledWith('/challenges', { page: 1, limit: 20 })
  expect(data.items).toHaveLength(1)
  expect(data.failed).toBe(false)

  internal.get.mockRejectedValue(new InternalServiceError('INTERNAL', 'down'))
  const failed = await loadDisputes()
  expect(failed).toMatchObject({ items: [], failed: true })
})

test('the disputes of a target are read with its id, and null says they could not be read', async () => {
  internal.get.mockResolvedValue(answer({ items: [summary()] }, { finalizedBlock: '123', page: { total: 1, page: 1, limit: 20 } }))
  const items = await loadChallengesOf(ID)
  expect(internal.get).toHaveBeenCalledWith('/challenges', { page: 1, limit: 20, targetId: ID })
  expect(items).toHaveLength(1)

  internal.get.mockRejectedValue(new InternalServiceError('INTERNAL', 'down'))
  expect(await loadChallengesOf(ID)).toBeNull()
})

test('a list row that does not fit the schema makes the whole list unreadable', async () => {
  internal.get.mockResolvedValue(answer({ items: [{ id: 'x' }] }, { finalizedBlock: '123', page: { total: 1, page: 1, limit: 20 } }))
  expect(await loadDisputes()).toMatchObject({ items: [], failed: true })
  expect(await loadChallengesOf(ID)).toBeNull()
})
