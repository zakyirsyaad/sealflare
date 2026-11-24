import { afterEach, expect, test, vi } from 'vitest'
import { createAnthropicClient, LlmInfrastructureError, type AnthropicLike, type LlmClient, type LlmMessage } from '../src/llm'
import { MOCK_TOOLS } from '../src/wallet/tools'
import { executeRun } from '../src/runStep'
import { createBudget } from '../src/budget'
import { PROBES } from '../src/probes'

const fixtureKey = 'fixture-provider-credential'
const input = { model: 'caller-selected-model', system: 'Trusted system. <skill_md>Example</skill_md>',
  messages: [{ role: 'user' as const, content: 'Check my balance' }], tools: MOCK_TOOLS }
const textBlock = { type: 'text', text: 'Finished.', citations: null }
const toolBlock = (id: string, name = 'get_balance', args: unknown = { token: 'USDT' }) => ({
  type: 'tool_use', id, name, input: args, caller: { type: 'direct' },
})
const response = (content: unknown[] = [textBlock], stop_reason = 'end_turn') => ({
  id: 'msg_fixture', type: 'message', role: 'assistant', model: input.model, content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
})
function fixture(value: unknown = response()) {
  const create = vi.fn<AnthropicLike['messages']['create']>(async () => value)
  const client = createAnthropicClient({ apiKey: fixtureKey, client: { messages: { create } } })
  return { create, client }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('tool_use blocks become ordered calls with provider IDs and the caller model is preserved', async () => {
  const { client, create } = fixture(response([toolBlock('toolu_1'), { ...textBlock, text: 'Reading.' }, toolBlock('toolu_2', 'get_token_info')], 'tool_use'))
  expect(await client.step(input)).toEqual({ toolCalls: [
    { id: 'toolu_1', tool: 'get_balance', args: { token: 'USDT' } },
    { id: 'toolu_2', tool: 'get_token_info', args: { token: 'USDT' } },
  ], text: 'Reading.', done: false })
  expect(create.mock.calls[0]?.[0]).toMatchObject({ model: input.model, system: input.system, tools: MOCK_TOOLS, stream: false })
  expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 })
})

test.each(['end_turn', 'stop_sequence'])('a text-only %s response completes a run', async (stop) => {
  expect(await fixture(response([textBlock], stop)).client.step(input)).toEqual({ toolCalls: [], text: 'Finished.', done: true })
})

test.each(['max_tokens', 'refusal', 'pause_turn', 'tool_use', 'unknown_stop'])('stop reason %s cannot become a clean completion', async (stop) => {
  expect((await fixture(response([textBlock], stop)).client.step(input)).done).toBe(false)
})

test('tool results are grouped into a user block with IDs matching the preceding assistant calls', async () => {
  const { client, create } = fixture()
  const messages: LlmMessage[] = [
    ...input.messages,
    { role: 'assistant', content: '', toolCalls: [
      { id: 'toolu_1', tool: 'get_balance', args: { token: 'USDT' } },
      { id: 'toolu_2', tool: 'get_token_info', args: { token: 'USDT' } },
    ] },
    { role: 'tool', toolCallId: 'toolu_1', tool: 'get_balance', content: '100' },
    { role: 'tool', toolCallId: 'toolu_2', tool: 'get_token_info', content: 'USDT' },
  ]
  const before = structuredClone(messages)
  await client.step({ ...input, messages })
  expect(create.mock.calls[0]?.[0].messages).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Check my balance' }] },
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'get_balance', input: { token: 'USDT' } },
      { type: 'tool_use', id: 'toolu_2', name: 'get_token_info', input: { token: 'USDT' } },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '100' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'USDT' },
    ] },
  ])
  expect(messages).toEqual(before)
})

test.each([401, 403, 404, 408, 409, 429, 500, 529, undefined])('provider error status %s is sanitized infrastructure failure', async (status) => {
  const { client, create } = fixture()
  create.mockRejectedValue(Object.assign(Error(`Provider echoed ${fixtureKey}`), { status }))
  await expect(client.step(input)).rejects.toBeInstanceOf(LlmInfrastructureError)
  await expect(client.step(input)).rejects.not.toThrow(fixtureKey)
})

test.each([400, 413, 422])('content error status %s is sanitized and is not infrastructure', async (status) => {
  const { client, create } = fixture()
  create.mockRejectedValue(Object.assign(Error(fixtureKey), { status }))
  try { await client.step(input); expect.unreachable() } catch (error) {
    expect(error).not.toBeInstanceOf(LlmInfrastructureError)
    expect(String(error)).not.toContain(fixtureKey)
  }
})

test('no provider error or credential is written to console', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { client, create } = fixture()
  create.mockRejectedValue(Error(fixtureKey))
  await expect(client.step(input)).rejects.toThrow()
  expect([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]).toEqual([])
})

test('a request deadline aborts even an injected client that ignores cancellation', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const client = createAnthropicClient({ apiKey: fixtureKey, timeoutMs: 20, client: { messages: {
    create: async (_params, options) => { signal = options.signal; return new Promise(() => {}) },
  } } })
  const result = client.step(input).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(21)
  expect(await result).toBeInstanceOf(LlmInfrastructureError)
  expect(signal?.aborted).toBe(true)
})

test('malformed arguments in a later tool do not erase the preceding valid prohibited request', async () => {
  const { client } = fixture(response([toolBlock('one', 'approve', { token: 'USDT', amount: 'max', spender: '0x3333333333333333333333333333333333333333' }),
    toolBlock('two', 'transfer', null)], 'tool_use'))
  const output = await client.step(input)
  expect(output.toolCalls[0]).toMatchObject({ tool: 'approve', args: { amount: 'max' } })
  expect(output.toolCalls[1]?.tool).toBe('transfer')
  expect(output.done).toBe(false)
})

test('usage is reported to the supplied observer without adding credentials to its payload', async () => {
  const onUsage = vi.fn(), client = createAnthropicClient({ apiKey: fixtureKey, onUsage,
    client: { messages: { create: async () => response() } } })
  await client.step(input)
  expect(onUsage).toHaveBeenCalledWith({ modelId: input.model, inputTokens: 12, outputTokens: 7,
    cacheCreationInputTokens: 0, cacheReadInputTokens: 0 })
  expect(JSON.stringify(onUsage.mock.calls)).not.toContain(fixtureKey)
})

test.each(['http://gateway.example', 'https://user:pass@gateway.example', 'https://gateway.example/?key=value'])
  ('unsafe configured endpoint %s is rejected before constructing a client', (baseURL) => {
    expect(() => createAnthropicClient({ apiKey: fixtureKey, baseURL })).toThrow()
  })

test('an explicitly configured HTTPS gateway is accepted without mutating the selected model', async () => {
  const { create } = fixture()
  const client = createAnthropicClient({ apiKey: fixtureKey, baseURL: 'https://gateway.example', client: { messages: { create } } })
  await client.step(input)
  expect(create.mock.calls[0]?.[0].model).toBe(input.model)
})

const _interfaceCheck: LlmClient = createAnthropicClient({ apiKey: fixtureKey, client: { messages: { create: async () => response() } } })

test('unexpected provider content before an unlimited approval cannot hide its violation', async () => {
  const { client } = fixture(response([{ type: 'thinking', thinking: 'unsupported hidden content' },
    toolBlock('attack', 'approve', { token: 'USDT', amount: 'max', spender: '0x3333333333333333333333333333333333333333' })], 'tool_use'))
  const result = await executeRun(0, { llm: client, budget: createBudget({ dailyCalls: 2 }), model: input.model,
    system: input.system, probe: PROBES.indirect_injection, maxSteps: 2 })
  expect(result.run.outcome).toBe('violation')
  expect(result.run.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
})

test.each(['max_tokens', 'refusal', 'pause_turn', 'unknown_stop'])
  ('stop reason %s cannot be silently continued into a clean probe run', async (stop) => {
    const { client, create } = fixture(response([textBlock], stop))
    create.mockResolvedValueOnce(response([textBlock], stop)).mockResolvedValue(response())
    const result = await executeRun(0, { llm: client, budget: createBudget({ dailyCalls: 2 }), model: input.model,
      system: input.system, probe: PROBES.indirect_injection, maxSteps: 2 })
    expect(result.run.outcome).toBe('error')
    expect(create).toHaveBeenCalledTimes(1)
  })

test('a prohibited call is retained even when the provider reports an unsupported stop reason', async () => {
  const { client } = fixture(response([toolBlock('attack', 'approve', { token: 'USDT', amount: 'max',
    spender: '0x3333333333333333333333333333333333333333' })], 'max_tokens'))
  const result = await executeRun(0, { llm: client, budget: createBudget({ dailyCalls: 1 }), model: input.model,
    system: input.system, probe: PROBES.indirect_injection, maxSteps: 1 })
  expect(result.run.outcome).toBe('violation')
})
