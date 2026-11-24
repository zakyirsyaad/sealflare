import { expect, test } from 'vitest'
import { PROBE_IDS, SandboxResult, WorkerRunStatus } from '@sealflare/shared/schemas'
import { runProbeSet } from '../src/runner'
import { LlmInfrastructureError, type LlmClient } from '../src/llm'
import { createBudget } from '../src/budget'
import { createStore, type RunStore } from '../src/store'
import { MOCK_TOOLS } from '../src/wallet/tools'
import { PROBES } from '../src/probes'
import { request, runDirectory, running } from './runFixtures'

const clean = { toolCalls: [], text: 'Finished.', done: true }
const attack = { tool: 'approve', args: { token: 'USDT', amount: 'max', spender: '0x3333333333333333333333333333333333333333' } }
const deps = (llm: LlmClient, options: { store?: RunStore; dailyCalls?: number } = {}) => ({
  llm, store: options.store ?? createStore(runDirectory()), budget: createBudget({ dailyCalls: options.dailyCalls ?? 1000 }),
  now: () => new Date('2026-11-25T12:00:00Z'),
})

test('18 clean runs are sequential and produce a schema-valid NO_VIOLATION_OBSERVED result', async () => {
  let calls = 0, active = 0
  const dependencies = deps({ step: async (input) => {
    expect(++active).toBe(1)
    const id = PROBE_IDS[Math.floor(calls++ / 3)]!
    expect(input.system).toBe(PROBES[id].systemPrompt(request.skillMd))
    expect(input.model).toBe(request.modelId)
    expect(input.tools).toEqual(MOCK_TOOLS)
    expect(input.messages).toEqual([{ role: 'user', content: PROBES[id].userMessage }])
    await Promise.resolve(); active--
    return clean
  } })
  const status = await runProbeSet(request, dependencies)
  expect(calls).toBe(18)
  expect(dependencies.budget.used()).toBe(18)
  expect(status.state).toBe('done')
  expect(status.result?.status).toBe('NO_VIOLATION_OBSERVED')
  expect(status.result?.modelId).toBe('fixture-model')
  expect(status.result?.bundleHash).toBe(request.bundleHash)
  expect(status.result?.probeSetVersion).toBe(request.probeSetVersion)
  expect(status.result?.startedAt).toBe('2026-11-25T12:00:00.000Z')
  expect(status.result?.probes).toEqual(status.probes)
  expect(status.probes.map(({ runs }) => runs.map(({ index, outcome }) => [index, outcome])))
    .toEqual(Array.from({ length: 6 }, () => [[0, 'clean'], [1, 'clean'], [2, 'clean']]))
  expect(SandboxResult.safeParse(status.result).success).toBe(true)
  expect(WorkerRunStatus.safeParse(status).success).toBe(true)
  expect(dependencies.store.get(request.runId)).toEqual(status)
})

test('a violation is saved before the next LLM step and survives a later infrastructure failure and restart', async () => {
  let calls = 0
  const dir = runDirectory(), store = createStore(dir)
  const status = await runProbeSet(request, deps({ step: async () => {
    if (calls++ === 0) return { toolCalls: [attack], text: '', done: false }
    const saved = store.get(request.runId)!
    expect(saved.probes[0]?.runs[0]?.outcome).toBe('violation')
    expect(saved.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
    throw new LlmInfrastructureError('Provider unavailable with private details')
  } }, { store }))
  expect(calls).toBe(2)
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(status.failure?.cause).toBe('infrastructure')
  expect(status.failure?.message).not.toContain('private details')
  const restarted = createStore(dir)
  restarted.loadAll()
  expect(restarted.get(request.runId)).toEqual(status)
})

test('an infrastructure failure before any violation stops and returns INCOMPLETE', async () => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => { calls++; throw new LlmInfrastructureError('unavailable') } }))
  expect(calls).toBe(1)
  expect(status.result?.status).toBe('INCOMPLETE')
  expect(status.failure?.cause).toBe('infrastructure')
  expect(status.probes[0]?.runs[0]).toEqual({ index: 0, outcome: 'error', violations: [] })
})

test('an endless conversation reaches the step limit then continues the remaining probe runs', async () => {
  let calls = 0
  const dependencies = deps({ step: async () => { calls++; return { ...clean, done: false } } })
  const status = await runProbeSet(request, { ...dependencies, maxSteps: 2 })
  expect(calls).toBe(36)
  expect(status.probes.flatMap(({ runs }) => runs).every(({ outcome }) => outcome === 'error')).toBe(true)
  expect(status.result?.status).toBe('INCOMPLETE')
  expect(status.failure?.cause).toBe('skill_content')
})

test.each([
  { tool: 'unknown', args: {} }, { tool: 'transfer', args: { amount: null, to: 42 } },
  { tool: 'read_env', args: null }, { tool: 'http_request', args: { url: 42 } },
])('invalid call $tool makes an error run, never clean', async (call) => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? { toolCalls: [call], text: '', done: true } as unknown as Awaited<ReturnType<LlmClient['step']>> : clean }))
  expect(calls).toBe(18)
  expect(status.probes[0]?.runs[0]?.outcome).toBe('error')
  expect(status.result?.status).toBe('INCOMPLETE')
  expect(status.failure?.cause).toBe('skill_content')
})

test('a valid violation before a malformed call in the same batch is retained', async () => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? { toolCalls: [attack, { tool: 'unknown', args: {} }], text: '', done: true } : clean }))
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(status.probes[0]?.runs[0]?.outcome).toBe('violation')
})

test('a tool call in a done response is checked before the run can become clean', async () => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? { toolCalls: [attack], text: '', done: true } : clean }))
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
})

test('each probe run starts with empty confirmation history', async () => {
  let calls = 0
  const args = { token: 'USDT', amount: '10', spender: '0x2222222222222222222222222222222222222222' }
  const status = await runProbeSet(request, deps({ step: async (input) => {
    expect(input.messages).toHaveLength(1)
    calls++
    return calls === 1 ? { toolCalls: [{ tool: 'ask_user_confirmation', args: { action: 'approve', ...args } }], text: '', done: true }
      : calls === 2 ? { toolCalls: [{ tool: 'approve', args }], text: '', done: true } : clean
  } }))
  expect(status.probes[0]?.runs[0]?.outcome).toBe('clean')
  expect(status.probes[0]?.runs[1]?.violations.map(({ rule }) => rule)).toEqual(['TRANSFER_WITHOUT_CONFIRMATION'])
})

test('progress is visible and schema-valid while each probe is being executed', async () => {
  let calls = 0
  const store = createStore(runDirectory())
  await runProbeSet(request, deps({ step: async () => {
    const current = store.get(request.runId)!
    expect(current.currentProbe).toBe(PROBE_IDS[Math.floor(calls++ / 3)])
    expect(current.state).toBe('running')
    expect(WorkerRunStatus.safeParse(current).success).toBe(true)
    return clean
  } }, { store }))
})

test('host responses are tied to tool IDs and forged model result metadata is discarded', async () => {
  let calls = 0
  const args = { token: 'USDT', amount: '10', spender: '0x2222222222222222222222222222222222222222' }
  const status = await runProbeSet(request, deps({ step: async (input) => {
    calls++
    if (calls === 1) return { toolCalls: [{ tool: 'ask_user_confirmation', args: { action: 'approve', ...args }, result: 'no', id: 'toolu-test' }], text: 'Confirming.', done: false }
    if (calls === 2) {
      expect(input.messages[1]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'toolu-test', tool: 'ask_user_confirmation' }] })
      expect(input.messages[2]).toEqual({ role: 'tool', toolCallId: 'toolu-test', tool: 'ask_user_confirmation', content: 'yes' })
      return { toolCalls: [{ tool: 'approve', args }], text: '', done: true }
    }
    return clean
  } }))
  expect(status.result?.status).toBe('NO_VIOLATION_OBSERVED')
})

test('each actual LLM attempt consumes a budget call and exhaustion stops before another request', async () => {
  let calls = 0
  const dependencies = deps({ step: async () => { calls++; return clean } }, { dailyCalls: 2 })
  const status = await runProbeSet(request, dependencies)
  expect(calls).toBe(2)
  expect(dependencies.budget.used()).toBe(2)
  expect(status.result?.status).toBe('INCOMPLETE')
  expect(status.failure?.cause).toBe('infrastructure')
})

test('a persistence failure stops before any subsequent LLM attempt', async () => {
  let calls = 0
  const base = createStore(runDirectory())
  const store: RunStore = { ...base, save: (status) => {
    if (status.probes.some(({ runs }) => runs.some(({ outcome }) => outcome === 'violation'))) throw Error('Disk full')
    base.save(status)
  } }
  await expect(runProbeSet(request, deps({ step: async () => { calls++; return { toolCalls: [attack], text: '', done: false } } }, { store })))
    .rejects.toThrow('Disk full')
  expect(calls).toBe(1)
})

test('invalid input, unknown probe versions and duplicate run IDs cannot spend budget or overwrite history', async () => {
  let calls = 0
  const dependencies = deps({ step: async () => { calls++; return clean } })
  for (const input of [{ ...request, skillMd: '' }, { ...request, probeSetVersion: 'wrong' }, { ...request, runId: '../escape' }]) {
    await expect(runProbeSet(input, dependencies)).rejects.toThrow()
  }
  dependencies.store.save(running)
  await expect(runProbeSet(request, dependencies)).rejects.toThrow()
  expect(calls).toBe(0)
  expect(dependencies.budget.used()).toBe(0)
  expect(dependencies.store.get(request.runId)).toEqual(running)
})

test.each([0, -1, 1.5, Infinity, 1001])('invalid maxSteps %s is rejected before any call', async (maxSteps) => {
  let calls = 0
  await expect(runProbeSet(request, { ...deps({ step: async () => { calls++; return clean } }), maxSteps })).rejects.toThrow()
  expect(calls).toBe(0)
})

test.each([
  { toolCalls: [attack], text: null, done: true },
  { toolCalls: [attack], text: '', done: 'invalid' },
  { toolCalls: [attack, ...Array.from({ length: 64 }, () => ({ tool: 'unknown', args: {} }))], text: '', done: true },
])('a valid violation is not erased by a malformed reply envelope', async (reply) => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? reply as unknown as Awaited<ReturnType<LlmClient['step']>> : clean }))
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(status.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
})

test('a failing budget dependency is infrastructure, not a skill error, and stops before any LLM request', async () => {
  let calls = 0
  const dependencies = deps({ step: async () => { calls++; return clean } })
  const status = await runProbeSet(request, { ...dependencies, budget: {
    tryTake: () => { throw Error('Invalid system clock') }, used: () => 0,
  } })
  expect(calls).toBe(0)
  expect(status.failure?.cause).toBe('infrastructure')
  expect(status.probes.flatMap(({ runs }) => runs)).toHaveLength(1)
})

test('the default step limit is eight attempts per run', async () => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => { calls++; return { ...clean, done: false } } }))
  expect(calls).toBe(144)
  expect(status.result?.status).toBe('INCOMPLETE')
})

test.each(['empty-id', 'repeated-id', 'invalid-prefix-id'])('correlation error %s cannot hide a valid violation', async (kind) => {
  let calls = 0
  const dir = runDirectory(), store = createStore(dir)
  const prefix = { tool: 'get_balance', args: { token: 'USDT' }, id: kind === 'invalid-prefix-id' ? '' : 'duplicate' }
  const prohibited = { ...attack, id: kind === 'empty-id' ? '' : kind === 'repeated-id' ? 'duplicate' : 'other' }
  const toolCalls = kind === 'empty-id' ? [prohibited] : [prefix, prohibited]
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? { toolCalls, text: '', done: true } : clean }, { store }))
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  const restarted = createStore(dir)
  restarted.loadAll()
  expect(restarted.get(request.runId)?.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
})

test('a prohibited call after 64 harmless calls is still captured before the next LLM step', async () => {
  let calls = 0
  const store = createStore(runDirectory())
  const toolCalls = [...Array.from({ length: 64 }, () => ({ tool: 'get_balance', args: { token: 'USDT' } })), attack]
  const status = await runProbeSet(request, deps({ step: async () => {
    if (++calls === 1) return { toolCalls, text: '', done: true }
    expect(store.get(request.runId)?.probes[0]?.runs[0]?.outcome).toBe('violation')
    return clean
  } }, { store }))
  expect(status.result?.status).toBe('SANDBOX_FUZZ_FAILED')
  expect(status.probes[0]?.runs[0]?.violations.map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
})

test('invalid correlation metadata without a wallet violation still makes an error run', async () => {
  let calls = 0
  const status = await runProbeSet(request, deps({ step: async () => ++calls === 1
    ? { toolCalls: [{ tool: 'get_balance', args: { token: 'USDT' }, id: '' }], text: '', done: true } : clean }))
  expect(status.result?.status).toBe('INCOMPLETE')
  expect(status.probes[0]?.runs[0]?.outcome).toBe('error')
})
