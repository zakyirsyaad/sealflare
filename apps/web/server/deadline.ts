/**
 * The deadline of a public request.
 *
 * A request that passes it answers with an error, never with half of its rows. The deadline
 * covers the whole request, so the internal service and the chain together cannot take longer
 * than this.
 */
export const DEADLINE_MS = 8_000

/** The moment a request that starts now has to be answered by. Created once, at the start of the route. */
export function deadlineFromNow(): number {
  return Date.now() + DEADLINE_MS
}

/**
 * The work of a request, with a deadline.
 *
 * The deadline is a moment, created once by the route and passed down, so the reads inside the
 * work stop at the same moment the answer goes out. The work is not cancelled when the deadline
 * passes, because the chain reads cannot be withdrawn. The answer goes out without them.
 */
export async function withDeadline<T>(work: Promise<T>, deadlineAt: number = deadlineFromNow()): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The deadline of the request passed.')), Math.max(0, deadlineAt - Date.now()))
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
