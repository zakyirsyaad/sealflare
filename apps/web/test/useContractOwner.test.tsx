import { expect, test, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const owner = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const contract = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const word = `0x${'00'.repeat(12)}${owner.slice(2).toLowerCase()}`

const client = vi.hoisted(() => ({
  getCode: vi.fn(),
  call: vi.fn(),
}))
vi.mock('wagmi', () => ({ usePublicClient: () => client }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
}))

import { useContractOwner } from '../lib/publish/useChainReads'

test('the owner is read from the data of the answer, as viem returns it', async () => {
  client.getCode.mockResolvedValue('0x6080')
  // `call` answers with an object that holds the data, not with the data itself.
  client.call.mockResolvedValue({ data: word })
  const { result } = renderHook(() => useContractOwner(contract))
  await waitFor(() => expect(result.current.status).toBe('owner'))
  expect(result.current.owner?.toLowerCase()).toBe(owner.toLowerCase())
})

test('a contract that answers with no data has no owner', async () => {
  client.getCode.mockResolvedValue('0x6080')
  client.call.mockResolvedValue({ data: undefined })
  const { result } = renderHook(() => useContractOwner(contract))
  await waitFor(() => expect(result.current.status).toBe('none'))
  expect(result.current.owner).toBeNull()
})
