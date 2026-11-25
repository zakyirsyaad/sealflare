// APIs checked 2026-11-25:
// https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools.ts
// https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/core/error.ts
// https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/internal/request-options.ts
// https://platform.claude.com/docs/en/api/errors
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { WorkerRunRequest } from '@sealflare/shared/schemas'
import type { MOCK_TOOLS, ToolCall } from './wallet/tools'
import { providerMessages } from './llmMessages'
import { ProviderUrl } from './providerUrl'
import { withDeadline } from './deadline'

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: { id: string; tool: string; args: Record<string, unknown> }[] }
  | { role: 'tool'; toolCallId: string; tool: string; content: string }

/** Implementations must settle each request; the real provider adapter owns network timeouts. */
export interface LlmClient {
  step(input: { model: string; system: string; messages: LlmMessage[]; tools: typeof MOCK_TOOLS }): Promise<{
    /** Optional provider IDs on calls are retained for tool-result correlation. result is never trusted. */
    toolCalls: ToolCall[]
    text: string
    done: boolean
  }>
}

export class LlmInfrastructureError extends Error {}
export class LlmContentError extends Error {}
export type Usage = { modelId: string; inputTokens: number; outputTokens: number;
  cacheCreationInputTokens: number; cacheReadInputTokens: number }
export interface AnthropicLike {
  messages: { create(input: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal: AbortSignal; timeout: number; maxRetries: number }): Promise<unknown> }
}
type Options = { apiKey: string; client?: AnthropicLike; baseURL?: string; timeoutMs?: number; onUsage?: (usage: Usage) => void }
const Reply = z.object({ content: z.array(z.unknown()), stop_reason: z.unknown().optional(), usage: z.unknown().optional() })
const TokenUsage = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().nullable().optional() })

function decodeReply(raw: unknown, modelId: string, onUsage?: Options['onUsage']) {
  const reply = Reply.parse(raw), texts: string[] = [], toolCalls: (ToolCall & { id?: string })[] = []
  let invalidContent = false
  for (const item of reply.content) {
    const block = z.record(z.string(), z.unknown()).safeParse(item)
    if (block.success && block.data.type === 'text' && typeof block.data.text === 'string') texts.push(block.data.text)
    else if (block.success && block.data.type === 'tool_use' && typeof block.data.name === 'string') {
      const args = z.record(z.string(), z.unknown()).safeParse(block.data.input)
      toolCalls.push({ id: typeof block.data.id === 'string' ? block.data.id : '', tool: block.data.name,
        args: args.success ? args.data : { invalidInput: block.data.input ?? null } })
    } else invalidContent = true
  }
  // Preserve all actual calls in order before rejecting unsupported provider metadata.
  if (invalidContent) toolCalls.push({ tool: 'invalid_provider_content', args: {} })
  const terminal = ['end_turn', 'stop_sequence'].includes(String(reply.stop_reason))
  if (!terminal && reply.stop_reason !== 'tool_use') toolCalls.push({ tool: 'invalid_provider_stop', args: {} })
  const usage = TokenUsage.safeParse(reply.usage)
  if (usage.success) onUsage?.({ modelId, inputTokens: usage.data.input_tokens, outputTokens: usage.data.output_tokens,
    cacheCreationInputTokens: usage.data.cache_creation_input_tokens ?? 0, cacheReadInputTokens: usage.data.cache_read_input_tokens ?? 0 })
  else toolCalls.push({ tool: 'invalid_provider_usage', args: {} })
  return { toolCalls, text: texts.join('\n'), done: toolCalls.length === 0 && terminal }
}

function providerError(error: unknown): Error {
  const outer = z.object({ status: z.number(), error: z.unknown() }).safeParse(error)
  const body = z.object({ error: z.object({ type: z.string(), message: z.string().max(16_384),
    details: z.object({ error_code: z.string().optional() }).nullish() }) }).safeParse(outer.success ? outer.data.error : null)
  if (outer.success && body.success) {
    const { type, message, details } = body.data.error, code = details?.error_code
    const account = /credit|billing|payment|spend|permission|model|api.?key|account/i.test(message)
    const conversation = /^prompt is too long\b|^messages(?:\.|\[|:).*(?:invalid|should be|must be|expected)/i.test(message)
    const tooLarge = outer.data.status === 413 && type === 'request_too_large' && !account
      && (!code || code === 'request_body_too_large_after_decoding')
    if (tooLarge || ([400, 422].includes(outer.data.status) && type === 'invalid_request_error'
      && !code && !account && conversation)) return new LlmContentError('The model could not process this conversation.')
  }
  return new LlmInfrastructureError('The model provider is unavailable.')
}

export function createAnthropicClient(options: Options): LlmClient {
  const apiKey = z.string().min(1).max(4096).regex(/^\S+$/).parse(options.apiKey)
  const baseURL = ProviderUrl.parse(options.baseURL ?? 'https://api.anthropic.com')
  const timeout = z.number().int().min(1).max(120_000).parse(options.timeoutMs ?? 30_000)
  const origin = new URL(baseURL).origin
  const client: AnthropicLike = options.client ?? new Anthropic({ apiKey, baseURL, timeout, maxRetries: 0, logLevel: 'off',
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== origin) throw Error('Provider origin changed.')
      return fetch(input, { ...init, redirect: 'error' })
    },
  })
  return { step: async (input) => {
    let parameters: Anthropic.MessageCreateParamsNonStreaming
    try {
      parameters = { model: WorkerRunRequest.shape.modelId.parse(input.model), system: z.string().min(1).max(1_048_576).parse(input.system),
        messages: providerMessages(input.messages), tools: input.tools, stream: false, max_tokens: 2048, thinking: { type: 'disabled' } }
    } catch { throw new LlmContentError('Invalid model conversation.') }
    try {
      const raw = await withDeadline((signal) => client.messages.create(parameters, { signal, timeout, maxRetries: 0 }), timeout)
      return decodeReply(raw, input.model, options.onUsage)
    } catch (error) { throw providerError(error) }
  } }
}
