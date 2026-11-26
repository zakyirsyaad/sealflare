import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { LlmMessage } from './llm'

const Text = z.string().max(65_536), Id = z.string().min(1).max(200)
const Message = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: Text }),
  z.object({ role: z.literal('assistant'), content: Text, toolCalls: z.array(z.object({
    id: Id, tool: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()),
  })) }),
  z.object({ role: z.literal('tool'), toolCallId: Id, tool: z.string(), content: Text }),
])

export function providerMessages(input: LlmMessage[]): Anthropic.MessageParam[] {
  const messages = z.array(Message).min(1).max(4096).parse(input)
  const output: { role: 'user' | 'assistant'; content: Anthropic.ContentBlockParam[] }[] = []
  const pending = new Set<string>()
  for (const message of messages) {
    const content: Anthropic.ContentBlockParam[] = []
    if (message.role === 'tool') {
      if (!pending.delete(message.toolCallId)) throw Error('Unmatched tool response.')
      content.push({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content })
    } else {
      if (pending.size) throw Error('Missing tool response.')
      if (message.content) content.push({ type: 'text', text: message.content })
      if (message.role === 'assistant') for (const call of message.toolCalls) {
        if (pending.has(call.id)) throw Error('Repeated tool ID.')
        pending.add(call.id)
        content.push({ type: 'tool_use', id: call.id, name: call.tool, input: call.args })
      }
    }
    if (!content.length) throw Error('Empty conversation message.')
    const role = message.role === 'assistant' ? 'assistant' : 'user', previous = output.at(-1)
    if (previous?.role === role) previous.content.push(...content)
    else output.push({ role, content })
  }
  if (pending.size || output[0]?.role !== 'user') throw Error('Incomplete conversation.')
  return output
}
