import type { MOCK_TOOLS, ToolCall } from './wallet/tools'

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
