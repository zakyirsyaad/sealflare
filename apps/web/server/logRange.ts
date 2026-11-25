/** The widest block range a public RPC reliably answers for one `getLogs` call. */
export const LOG_RANGE = 10_000n
/** About 17 days of BSC blocks. A longer span is refused instead of being searched halfway. */
export const MAX_LOG_RANGES = 200
/** How many ranges are requested at the same time. */
const PARALLEL = 4

/** Cuts [from, to] into bounded, contiguous ranges. */
export function ranges(from: bigint, to: bigint, size: bigint = LOG_RANGE): Array<[bigint, bigint]> {
  if (from > to) return []
  if ((to - from) / size + 1n > BigInt(MAX_LOG_RANGES)) {
    throw new RangeError('The block span is too long to read from a public RPC.')
  }
  const result: Array<[bigint, bigint]> = []
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n
    result.push([start, end < to ? end : to])
  }
  return result
}

/**
 * The logs of every range, in order. One failed range fails the whole read: a list with a hole in
 * it must never be shown as the complete one.
 */
export async function collectLogs<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  size: bigint = LOG_RANGE,
): Promise<T[]> {
  const spans = ranges(from, to, size)
  const logs: T[] = []
  for (let start = 0; start < spans.length; start += PARALLEL) {
    const batch = spans.slice(start, start + PARALLEL)
    const answers = await Promise.all(batch.map(([low, high]) => fetchRange(low, high)))
    for (const answer of answers) logs.push(...answer)
  }
  return logs
}

/**
 * The first block whose timestamp is at or after `timestamp`, by binary search. A target is created
 * in a block with exactly its `createdAt`, so this block is never later than the creation block.
 */
export async function firstBlockAtOrAfter(
  timestamp: number,
  head: bigint,
  timestampOf: (block: bigint) => Promise<number>,
): Promise<bigint> {
  let low = 0n
  let high = head
  while (low < high) {
    const middle = (low + high) / 2n
    if ((await timestampOf(middle)) >= timestamp) high = middle
    else low = middle + 1n
  }
  return low
}
