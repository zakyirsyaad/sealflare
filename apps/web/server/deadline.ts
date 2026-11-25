/**
 * The deadline of a public request.
 *
 * A request that passes it answers with an error, never with half of its rows. The deadline
 * covers the whole request, so the internal service and the chain together cannot take longer
 * than this.
 */
export const DEADLINE_MS = 8_000

/**
 * The work of a request, with a deadline.
 *
 * The work is not cancelled when the deadline passes, because the chain reads cannot be
 * withdrawn. The answer goes out without them.
 */
export async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The deadline of the request passed.')), DEADLINE_MS)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
