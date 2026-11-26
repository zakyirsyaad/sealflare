import Anthropic from '@anthropic-ai/sdk'
import { expect, test } from 'vitest'
import { createAnthropicClient, LlmContentError } from '../src/llm'
import { MOCK_TOOLS } from '../src/wallet/tools'

const input = { model: 'fixture-model', system: 'Wallet host.',
  messages: [{ role: 'user' as const, content: 'Check a balance.' }], tools: MOCK_TOOLS }

function blocked(message: string, code?: string) {
  return new Anthropic.APIError(400, { type: 'error', error: { type: 'invalid_request_error', message,
    ...(code ? { details: { error_code: code } } : {}) } }, undefined, new Headers())
}

test.each([
  blocked('Output blocked by content filtering policy.'),
  blocked('Request content was blocked by the safety policy.'),
  blocked('The generated response was filtered.', 'content_filter_blocked'),
])('provider policy blocks caused by conversation content are content errors', async (error) => {
  const client = createAnthropicClient({ apiKey: 'fixture-provider-key',
    client: { messages: { create: async () => { throw error } } } })
  await expect(client.step(input)).rejects.toBeInstanceOf(LlmContentError)
})
