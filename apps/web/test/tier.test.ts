import { describe, expect, test, vi } from 'vitest'
import type { Hex } from 'viem'
import type { TrustTier } from '@sealflare/shared/rules'
import { tiersAt } from '../server/tier'
import type { ChainReader } from '../server/chain'

const id = (index: number): Hex => `0x${String(index).padStart(64, '0')}` as Hex

/** A reader that counts how many tier reads run at the same time. */
function readerWith(count: number, block = 96n) {
  let running = 0
  let peak = 0
  const tierAt = vi.fn(async (_targetId: Hex, _block: bigint): Promise<TrustTier> => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, 2))
    running -= 1
    return 'COMMUNITY_SAFE'
  })
  const reader = {
    tierBlockNumber: async () => block,
    tierAt,
  } as unknown as ChainReader
  return { reader, tierAt, peak: () => peak, count }
}

describe('the tiers of a list of targets', () => {
  test('every tier of one answer is read at the same block', async () => {
    const { reader, tierAt } = readerWith(3)
    const targets = [id(1), id(2), id(3)]

    const tiers = await tiersAt(reader, targets, Date.now() + 5_000)

    expect(tiers.size).toBe(3)
    const blocks = new Set(tierAt.mock.calls.map(call => String(call[1])))
    expect(blocks.size).toBe(1)
    expect(tierAt.mock.calls[0]![1]).toBe(96n)
  })

  test('the reads of a batch leave at the same time, so they go out in one request', async () => {
    const { reader, tierAt, peak } = readerWith(250)
    const targets = Array.from({ length: 250 }, (_, index) => id(index + 1))

    await tiersAt(reader, targets, Date.now() + 5_000)

    expect(tierAt).toHaveBeenCalledTimes(250)
    // A whole batch is read at the same time, so the transport of the chain puts them in one
    // request instead of one request each.
    expect(peak()).toBe(100)
  })

  test('the reads stop when the deadline has passed, so the chain is not kept busy', async () => {
    const { reader, tierAt } = readerWith(250)
    const targets = Array.from({ length: 250 }, (_, index) => id(index + 1))

    await expect(tiersAt(reader, targets, Date.now() - 1)).rejects.toThrow(/deadline/)
    expect(tierAt).not.toHaveBeenCalled()
  })

  test('a list without targets asks the chain for nothing', async () => {
    const { reader, tierAt } = readerWith(0)

    const tiers = await tiersAt(reader, [], Date.now() + 5_000)

    expect(tiers.size).toBe(0)
    expect(tierAt).not.toHaveBeenCalled()
  })
})
