/** Bounds injected transports as well as real requests and always releases the timer. */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work(controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('Operation timed out.')) }, timeoutMs)
    })])
  } finally { clearTimeout(timer); controller.abort() }
}
