import { expect, test } from 'vitest'
import { waitForQueue } from '../src/shutdown'

test('the service waits for the pass of the queue that is in flight', async () => {
  let passed = false
  const queue = (async (): Promise<void> => {
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    passed = true
  })()

  await waitForQueue(queue, 1_000)

  // The pass is over before the pool of the database is closed, so the refund of a failed run is
  // not lost.
  expect(passed).toBe(true)
})

test('a queue that never ends does not keep the service alive', async () => {
  const started = Date.now()

  await waitForQueue(new Promise<void>(() => {}), 20)

  expect(Date.now() - started).toBeLessThan(5_000)
})

test('a service without a sandbox has no queue to wait for', async () => {
  await expect(waitForQueue(null)).resolves.toBeUndefined()
})
