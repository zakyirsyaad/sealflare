import Anthropic from '@anthropic-ai/sdk'
import { expect, test } from 'vitest'
import { createAnthropicClient, LlmContentError, LlmInfrastructureError } from '../src/llm'
import { MOCK_TOOLS } from '../src/wallet/tools'

const credential = 'fixture-credential-never-returned'
const input = { model: 'caller-model', system: 'Wallet simulation.', messages: [{ role: 'user' as const, content: 'Read a balance' }], tools: MOCK_TOOLS }
const failure = (status: number, type: string, message: string, code?: string) => new Anthropic.APIError(status,
  { type: 'error', error: { type, message, ...(code ? { details: { error_code: code } } : {}) } }, undefined, new Headers())
const clientFor = (error: unknown) => createAnthropicClient({ apiKey: credential, client: { messages: { create: async () => { throw error } } } })

test.each([
  failure(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'),
  failure(400, 'invalid_request_error', 'Organization has reached its spend limit.'),
  failure(400, 'invalid_request_error', 'Model does not exist or you do not have access to it.'),
  failure(400, 'invalid_request_error', 'Invalid model: unavailable-model'),
  failure(400, 'permission_error', 'Permission denied.'),
  failure(400, 'billing_error', 'Payment method is invalid.'),
  failure(400, 'invalid_request_error', 'tools.0.input_schema: invalid schema'),
  failure(400, 'invalid_request_error', 'Unknown provider failure.'),
  failure(400, 'invalid_request_error', 'prompt is too long: account error', 'enforced_spend_limit_reached'),
  failure(413, 'request_too_large', 'Your credit balance is too low.'),
  Object.assign(Error(credential), { status: 400 }),
  Object.assign(Error(credential), { status: 413 }),
  Object.assign(Error(credential), { status: 422 }),
])('account, model, operator and unknown errors are sanitized infrastructure failures: %j', async (error) => {
  await expect(clientFor(error).step(input)).rejects.toBeInstanceOf(LlmInfrastructureError)
  await expect(clientFor(error).step(input)).rejects.not.toThrow(credential)
})

test.each([
  failure(400, 'invalid_request_error', 'prompt is too long: 210000 tokens > 200000 maximum'),
  failure(422, 'invalid_request_error', 'messages.0.content.0.input: Input should be a valid dictionary'),
  failure(413, 'request_too_large', 'Request exceeds the maximum allowed number of bytes'),
])('a structured error naming invalid conversation content remains a content error: %j', async (error) => {
  await expect(clientFor(error).step(input)).rejects.toBeInstanceOf(LlmContentError)
})
