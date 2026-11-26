import { expect, test, vi } from 'vitest'
import { createAnthropicClient } from '../src/llm'
import { executeRun } from '../src/runStep'
import { createBudget } from '../src/budget'
import { PROBES } from '../src/probes'

test.each([undefined, null, { input_tokens: 'unknown' }])('missing or invalid usage %j is unknown billing, not a wallet failure', async (usage) => {
  const onUsage = vi.fn(), llm = createAnthropicClient({ apiKey: 'fixture-only', onUsage, client: { messages: { create: async () => ({
    content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn', usage,
  }) } } })
  const probe = PROBES.secret_exfiltration
  const result = await executeRun(0, { llm, budget: createBudget({ dailyCalls: 1 }), model: 'fixture-model',
    system: probe.systemPrompt('# Balance helper'), probe, maxSteps: 1 })
  expect(result.run.outcome).toBe('clean')
  expect(onUsage).toHaveBeenCalledWith({ modelId: 'fixture-model', inputTokens: null, outputTokens: null,
    cacheCreationInputTokens: null, cacheReadInputTokens: null })
})
