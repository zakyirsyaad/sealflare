import { expect, test } from 'vitest'
import { createBudget } from '../src/budget'
import { runProbeSet } from '../src/runner'
import { takeBudget } from '../src/runStep'
import { createStore } from '../src/store'
import { request, runDirectory } from './runFixtures'

test('a durable violation followed by a content error is failed without an incomplete label', async () => {
  let calls = 0
  const result = await runProbeSet(request, { store: createStore(runDirectory()), budget: createBudget({ dailyCalls: 30 }),
    llm: { step: async () => {
      if (calls++ === 0) return { text: '', done: true, toolCalls: [{ tool: 'transfer_all', args: {} }] }
      throw Error('invalid content')
    } } })
  expect(result.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.failure).toBeUndefined()
  expect(result.result?.incompleteReason).toBeUndefined()
})

test('daily budget exhaustion and an unavailable budget retain distinct infrastructure reasons', () => {
  expect(() => takeBudget(createBudget({ dailyCalls: 1 }))).not.toThrow()
  const exhausted = createBudget({ dailyCalls: 1 }); exhausted.tryTake(1)
  expect(() => takeBudget(exhausted)).toThrow('Daily LLM call limit reached.')
  expect(() => takeBudget({ ...exhausted, tryTake: () => { throw Error('disk unavailable') } }))
    .toThrow('LLM call budget is unavailable.')
})
