import { z } from 'zod'
import type { ProbeRun } from '@sealflare/shared/schemas'
import { LlmInfrastructureError, type LlmClient, type LlmMessage } from './llm'
import type { Budget } from './budget'
import type { Probe } from './probes'
import { findViolations } from './wallet/rules'
import { MOCK_TOOLS, ToolCall, respondTo } from './wallet/tools'

const Envelope = z.object({ toolCalls: z.array(z.unknown()) })
const Reply = z.object({ text: z.string().max(65_536), done: z.boolean() })
const ModelCall = ToolCall.omit({ result: true }).extend({ id: z.string().min(1).max(200).optional() })
type Run = z.infer<typeof ProbeRun>
type Trace = { history: ToolCall[]; messages: LlmMessage[]; ids: Set<string> }
type Step = { llm: LlmClient; budget: Budget; model: string; system: string; probe: Probe; maxSteps: number }

function useTool(input: unknown, step: number, index: number, trace: Trace, probe: Probe) {
  const parsed = ModelCall.parse(input), id = parsed.id ?? `call-${step}-${index}`
  if (trace.ids.has(id)) throw Error('Repeated tool call ID.')
  trace.ids.add(id)
  const call = { tool: parsed.tool, args: parsed.args }
  const result = respondTo(call, probe.context, probe.scenario)
  trace.history.push({ ...call, result })
  return { call: { ...call, id }, message: { role: 'tool' as const, tool: call.tool, toolCallId: id, content: result } }
}

function processReply(input: unknown, step: number, trace: Trace, probe: Probe) {
  const envelope = Envelope.parse(input), calls: Extract<LlmMessage, { role: 'assistant' }>['toolCalls'] = []
  const results: LlmMessage[] = []
  for (const [index, raw] of envelope.toolCalls.slice(0, 64).entries()) {
    const { call, message } = useTool(raw, step, index, trace, probe)
    calls.push(call); results.push(message)
    const violations = findViolations(trace.history, probe.context)
    if (violations.length) return { outcome: 'violation' as const, violations }
  }
  if (envelope.toolCalls.length > 64) throw Error('Too many tool calls.')
  const reply = Reply.parse(input)
  trace.messages.push({ role: 'assistant', content: reply.text, toolCalls: calls }, ...results)
  return reply.done ? { outcome: 'clean' as const, violations: [] } : null
}

function takeBudget(budget: Budget): void {
  try {
    if (!budget.tryTake(1)) throw new LlmInfrastructureError('Daily LLM call limit reached.')
  } catch { throw new LlmInfrastructureError('LLM call budget is unavailable.') }
}

/** One isolated probe run; persisted aggregate updates are the caller's responsibility. */
export async function executeRun(index: Run['index'], input: Step): Promise<{ run: Run; infrastructure: boolean }> {
  const trace: Trace = { history: [], messages: [{ role: 'user', content: input.probe.userMessage }], ids: new Set() }
  try {
    for (let step = 0; step < input.maxSteps; step++) {
      takeBudget(input.budget)
      const response = await input.llm.step({ model: input.model, system: input.system,
        messages: structuredClone(trace.messages), tools: structuredClone(MOCK_TOOLS) })
      const result = processReply(response, step, trace, input.probe)
      if (result) return { run: { index, ...result }, infrastructure: false }
    }
    return { run: { index, outcome: 'error', violations: [] }, infrastructure: false }
  } catch (error) {
    return { run: { index, outcome: 'error', violations: [] }, infrastructure: error instanceof LlmInfrastructureError }
  }
}
