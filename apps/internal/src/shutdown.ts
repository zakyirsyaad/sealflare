/**
 * The end of the service.
 *
 * The queue is stopped before the pool of the database is closed, so a pass that is in flight can
 * still write its result and give the slot of a failed run back. The wait has a bound, so a
 * worker that never answers does not keep the service alive.
 */

/**
 * How long the service waits for the pass of the queue that is in flight.
 *
 * The grace is shorter than the ten seconds a `docker stop` waits before it kills the container,
 * so the service is gone before the container is killed. The service that runs in Docker should
 * also get a `stop_grace_period` of its own, so the pass of the queue is never cut off in the
 * middle of a refund.
 */
export const SHUTDOWN_GRACE_MS = 8_000

/**
 * Waits for the queue to finish the pass it is in.
 *
 * The queue ends when it is told to stop, so the wait is over as soon as the pass that is in
 * flight is done. A queue that does not end is left behind after the bound, because a service
 * that never goes down is worse than a pass that is cut off.
 */
export async function waitForQueue(queue: Promise<void> | null, graceMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
  if (queue === null) return
  // A queue that failed is reported where it failed, so the wait does not fail the shutdown.
  await Promise.race([queue.catch(() => undefined), timeout(graceMs)])
}

/** A promise that is done after the given number of milliseconds. */
function timeout(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
