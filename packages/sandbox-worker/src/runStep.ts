import { z } from 'zod'
import type { ProbeRun } from '@sealflare/shared/schemas'
import { LlmInfrastructureError, type LlmClient, type LlmMessage } from './llm'
import type { Budget } from './budget'
import type { Probe } from './probes'
import { findViolations } from './wallet/rules'
import { MOCK_TOOLS, ToolCall, respondTo } from './wallet/tools'

const Envelope = z.object({ toolCalls: z.array(z.unknown()) })
const Reply = z.object({ text: z.string().max(65_536), done: z.boolean() })
const ModelCall = ToolCall.omit({ result: true })
const Attempt = ModelCall.extend({ args: z.unknown() })
const Correlation = z.object({ id: z.string().min(1).max(200).optional() })
type Run = z.infer<typeof ProbeRun>
type Trace = { history: ToolCall[]; messages: LlmMessage[]; ids: Set<string> }
type Step = { llm: LlmClient; budget: Budget; model: string; system: string; probe: Probe; maxSteps: number }
type ToolResult = { call: ToolCall; result: string } | { violations: ReturnType<typeof findViolations> }

function useTool(input: unknown, trace: Trace, probe: Probe): ToolResult {
  const attempt = Attempt.parse(input), args = ModelCall.shape.args.safeParse(attempt.args)
  const call: ToolCall = { tool: attempt.tool, args: args.success ? args.data : { invalidArgs: attempt.args ?? null } }
  trace.history.push(call)
  const violations = findViolations(trace.history, probe.context)
  if (violations.length) return { violations }
  const result = respondTo(ModelCall.parse(input), probe.context, probe.scenario)
  call.result = result // Only a successful host response can authorize a later call.
  return { call, result }
}

function processReply(input: unknown, step: number, trace: Trace, probe: Probe) {
  const envelope = Envelope.parse(input), completed: Extract<ToolResult, { call: ToolCall }>[] = []
  let invalid = false
  for (const raw of envelope.toolCalls) {
    try {
      const result = useTool(raw, trace, probe)
      if ('violations' in result) return { outcome: 'violation' as const, violations: result.violations }
      completed.push(result)
    } catch { invalid = true } // Audit remaining attempted calls before reporting a content error.
  }
  if (invalid) throw Error('Invalid mock tool call.')
  // Correlation metadata cannot erase wallet evidence anywhere in the same response.
  const calls: Extract<LlmMessage, { role: 'assistant' }>['toolCalls'] = [], results: LlmMessage[] = []
  for (const [index, { call, result }] of completed.entries()) {
    const id = Correlation.parse(envelope.toolCalls[index]).id ?? `call-${step}-${index}`
    if (trace.ids.has(id)) throw Error('Repeated tool call ID.')
    trace.ids.add(id)
    calls.push({ ...call, id }); results.push({ role: 'tool', tool: call.tool, toolCallId: id, content: result })
  }
  const reply = Reply.parse(input)
  trace.messages.push({ role: 'assistant', content: reply.text, toolCalls: calls }, ...results)
  return reply.done ? { outcome: 'clean' as const, violations: [] } : null
}

export function takeBudget(budget: Budget): void {
  try {
    if (!budget.tryTake(1)) throw new LlmInfrastructureError('Daily LLM call limit reached.')
  } catch (error) { throw error instanceof LlmInfrastructureError ? error : new LlmInfrastructureError('LLM call budget is unavailable.') }
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
