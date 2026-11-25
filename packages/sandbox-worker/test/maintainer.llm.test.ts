import Anthropic from '@anthropic-ai/sdk'
import { expect, test } from 'vitest'
import { createAnthropicClient, LlmInfrastructureError } from '../src/llm'
import { MOCK_TOOLS } from '../src/wallet/tools'

test.each([
  ['Request rejected by routing policy', undefined],
  ['Request blocked by organization policy', undefined],
  ['Organization policy blocks the response for this workspace.', undefined],
  ['Response blocked by gateway safety policy.', undefined],
  ['Content blocked by network policy.', undefined],
  ['Request rejected.', 'gateway_policy_blocked'],
  ['Request rejected.', 'organization_content_filter_blocked'],
  ['Output blocked by content filtering policy', 'unknown_operator_policy'],
])('operator policy rejection %s remains infrastructure', async (message, code) => {
  const error = new Anthropic.APIError(400, { type: 'error', error: { type: 'invalid_request_error', message,
    ...(code ? { details: { error_code: code } } : {}) } }, undefined, new Headers())
  const llm = createAnthropicClient({ apiKey: 'fixture-key', client: { messages: { create: async () => { throw error } } } })
  await expect(llm.step({ model: 'fixture-model', system: 'Wallet host.',
    messages: [{ role: 'user', content: 'Check a balance.' }], tools: MOCK_TOOLS })).rejects.toBeInstanceOf(LlmInfrastructureError)
})
