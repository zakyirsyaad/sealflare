import { expect, test, vi } from 'vitest'
import { LOG_RANGE, MAX_LOG_RANGES, collectLogs, firstBlockAtOrAfter, ranges } from '../server/logRange'

test('a block span is cut into bounded ranges with no gap and no overlap', () => {
  expect(ranges(0n, 25_000n, 10_000n)).toEqual([[0n, 9_999n], [10_000n, 19_999n], [20_000n, 25_000n]])
  expect(ranges(5n, 5n, 10n)).toEqual([[5n, 5n]])
  expect(ranges(10n, 5n, 10n)).toEqual([])
})

test('every range is at most the size the public RPCs accept', () => {
  for (const [from, to] of ranges(1n, 123_456n)) expect(to - from + 1n).toBeLessThanOrEqual(LOG_RANGE)
})

test('a span that would need more than the cap of requests is refused instead of searched halfway', () => {
  expect(() => ranges(0n, BigInt(MAX_LOG_RANGES + 1) * 10n, 10n)).toThrow(RangeError)
  expect(() => ranges(0n, BigInt(MAX_LOG_RANGES) * 10n - 1n, 10n)).not.toThrow()
})

test('the window covers ten million blocks, about three months of BNB Chain', () => {
  expect(MAX_LOG_RANGES * Number(LOG_RANGE)).toBe(10_000_000)
  expect(() => ranges(0n, 9_999_999n)).not.toThrow()
})

test('the logs of all ranges come back in order', async () => {
  const fetchRange = vi.fn(async (from: bigint) => [`log@${from}`])
  const logs = await collectLogs(fetchRange, 0n, 25_000n, 10_000n)
  expect(logs).toEqual(['log@0', 'log@10000', 'log@20000'])
})

test('one failed range fails the whole read, so a partial list is never shown as the full one', async () => {
  const fetchRange = vi.fn(async (from: bigint) => {
    if (from === 10_000n) throw new Error('range too wide')
    return [`log@${from}`]
  })
  await expect(collectLogs(fetchRange, 0n, 25_000n, 10_000n)).rejects.toThrow('range too wide')
})

test('the first block at or after a time is found with a logarithmic number of reads', async () => {
  const timestampOf = vi.fn(async (block: bigint) => 1_000 + Number(block) * 3)
  const block = await firstBlockAtOrAfter(1_000 + 3 * 777_777, 52_000_000n, timestampOf)
  expect(block).toBe(777_777n)
  expect(timestampOf.mock.calls.length).toBeLessThanOrEqual(30)
})

test('a time before the first block starts at block 0 and a time after the head stops at the head', async () => {
  const timestampOf = async (block: bigint) => 1_000 + Number(block) * 3
  expect(await firstBlockAtOrAfter(5, 100n, timestampOf)).toBe(0n)
  expect(await firstBlockAtOrAfter(9_999_999, 100n, timestampOf)).toBe(100n)
})

test('blocks that share a timestamp give a block no later than the first of them', async () => {
  const timestampOf = async (block: bigint) => 1_000 + Number(block / 4n)
  const block = await firstBlockAtOrAfter(1_010, 1_000n, timestampOf)
  expect(block).toBe(40n)
})
