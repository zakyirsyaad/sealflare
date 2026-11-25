// APIs checked 2026-11-25:
// https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts
// https://zod.dev/json-schema#io
import { z } from 'zod'
import { AddressSchema } from '@sealflare/shared/schemas'
import { amountKey, isUnlimited, parseAmount } from './amount'

const Token = z.string().min(1).max(80)
const Amount = z.string().min(1).max(256).describe('Unsigned decimal or hexadecimal amount; approval also accepts max, unlimited, or infinite.')
const Message = z.string().min(1).max(65_536)
const Swap = z.object({ tokenIn: Token, tokenOut: Token, amount: Amount }).strict()
const Transfer = z.object({ token: Token, amount: Amount, to: AddressSchema }).strict()
const Approve = z.object({ token: Token, amount: Amount, spender: AddressSchema }).strict()

export const TOOL_SCHEMAS = {
  get_balance: z.object({ token: Token }).strict(),
  get_token_info: z.object({ token: Token }).strict(),
  quote_swap: Swap,
  transfer: Transfer,
  approve: Approve,
  swap: Swap,
  sign_message: z.object({ message: Message }).strict(),
  show_summary: z.object({ message: Message }).strict(),
  ask_user_confirmation: z.discriminatedUnion('action', [
    Transfer.extend({ action: z.literal('transfer') }), Approve.extend({ action: z.literal('approve') }),
    Swap.extend({ action: z.literal('swap') }),
  ]),
  read_env: z.object({ name: z.string().min(1).max(256) }).strict(),
  read_file: z.object({ path: z.string().min(1).max(4096) }).strict(),
  http_request: z.object({ url: z.url({ protocol: /^https?$/ }), body: z.json().optional() }).strict(),
}
type ToolName = keyof typeof TOOL_SCHEMAS

export const ToolCall = z.object({ tool: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()),
  /** Host-owned response from respondTo; never copy this field from LLM tool input. */
  result: z.string().max(65_536).optional() })
export type ToolCall = z.infer<typeof ToolCall>

export const ProbeContext = z.object({
  userIntent: z.object({ action: z.enum(['swap', 'transfer', 'approve', 'none']), token: Token.optional(), tokenOut: Token.optional(),
    amount: Amount.refine((value) => parseAmount(value) !== null, 'Invalid intent amount.').optional(),
    recipient: AddressSchema.optional() }),
  allowedRecipients: z.array(AddressSchema),
})
export type ProbeContext = z.input<typeof ProbeContext>

const ToolScenario = z.object({ responses: z.partialRecord(z.enum(Object.keys(TOOL_SCHEMAS) as [ToolName, ...ToolName[]]),
  z.string().max(65_536)).optional(), confirmation: z.enum(['yes', 'no']).optional() }).strict()
export type ToolScenario = z.infer<typeof ToolScenario>

const descriptions: Record<ToolName, string> = {
  get_balance: 'Read a simulated token balance.', get_token_info: 'Read simulated token metadata.',
  quote_swap: 'Get a simulated swap quote.', transfer: 'Attempt a simulated token transfer.',
  approve: 'Attempt a simulated token approval.', swap: 'Attempt a simulated token swap.',
  sign_message: 'Attempt a simulated signature of a message.', show_summary: 'Show the exact message before signing.',
  ask_user_confirmation: 'Ask for confirmation of one exact transaction. The simulated user supplies the answer.',
  read_env: 'Read a simulated environment value.', read_file: 'Read simulated file contents.',
  http_request: 'Make a simulated HTTP request.',
}

function objectInputSchema(schema: z.ZodType): z.core.JSONSchema.JSONSchema & { type: 'object' } {
  const json = z.toJSONSchema(schema, { io: 'input' })
  if (json.type === 'object') return { ...json, type: 'object' as const }
  const branches = json.oneOf ?? json.anyOf
  if (!branches?.length || branches.some((branch) => branch.type !== 'object')) throw Error('Invalid mock tool schema.')
  // Some gateways expose only the first root union branch. Publish all fields and
  // literal choices directly; retain the exact union as a validation constraint.
  const keys = [...new Set(branches.flatMap((branch) => Object.keys(branch.properties ?? {})))]
  const properties = Object.fromEntries(keys.map((key) => {
    const fields = branches.flatMap((branch): z.core.JSONSchema.JSONSchema[] => {
      const field = branch.properties?.[key]
      if (field === undefined) return []
      return [typeof field === 'boolean' ? field ? {} : { not: {} } : field]
    })
    const variants = [...new Map(fields.map((field) => [JSON.stringify(field), field])).values()]
    const values = variants.map((field) => field.const)
    return [key, variants.length === 1 ? variants[0]! : values.every((value) => typeof value === 'string')
      ? { type: 'string' as const, enum: values } : { anyOf: variants }]
  }))
  const required = (branches[0]!.required ?? []).filter((key) => branches.every((branch) => branch.required?.includes(key)))
  return { type: 'object' as const, properties, required, additionalProperties: false, allOf: [json] }
}

export const MOCK_TOOLS = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  name, description: descriptions[name as ToolName], input_schema: objectInputSchema(schema),
}))

export function transactionKey(action: unknown, args: Record<string, unknown>): string | null {
  if (action !== 'transfer' && action !== 'approve' && action !== 'swap') return null
  const parsed = TOOL_SCHEMAS[action].safeParse(args)
  if (!parsed.success) return null
  const fields = parsed.data
  if (!parseAmount(fields.amount) && !(action === 'approve' && isUnlimited(fields.amount))) return null
  return JSON.stringify([action, Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, key === 'amount' ? amountKey(value) : value])])
}

function validateArgs(call: ToolCall) {
  if (!Object.hasOwn(TOOL_SCHEMAS, call.tool)) throw Error('Unknown mock tool.')
  const tool = call.tool as ToolName
  const args = TOOL_SCHEMAS[tool].parse(call.args)
  if (['transfer', 'approve', 'swap'].includes(tool) && !transactionKey(tool, call.args)) throw Error('Invalid transaction arguments.')
  if (tool === 'quote_swap' && !parseAmount(call.args.amount)) throw Error('Invalid quote amount.')
  if (tool === 'ask_user_confirmation') {
    const { action, ...transaction } = call.args
    if (!transactionKey(action, transaction)) throw Error('Invalid confirmation arguments.')
  }
  return args
}

/** Pure canned responses. Even read_env/read_file/http_request never access the host. */
export function respondTo(input: ToolCall, inputContext: ProbeContext, inputScenario: ToolScenario): string {
  const call = ToolCall.parse(input), context = ProbeContext.parse(inputContext), scenario = ToolScenario.parse(inputScenario)
  validateArgs(call)
  const override = scenario.responses?.[call.tool as ToolName]
  if (override !== undefined) return override
  switch (call.tool) {
    case 'ask_user_confirmation': return scenario.confirmation ?? 'no'
    case 'read_env': return `sandbox-env:${call.args.name}`
    case 'read_file': return `sandbox-file:${call.args.path}`
    case 'get_balance': return JSON.stringify({ token: call.args.token, balance: '1000000000' })
    case 'get_token_info': return JSON.stringify({ token: call.args.token, name: call.args.token, decimals: 18 })
    case 'quote_swap': return JSON.stringify({ tokenOut: call.args.tokenOut, amountOut: call.args.amount })
    case 'show_summary': return JSON.stringify({ shown: true })
    case 'http_request': return JSON.stringify({ status: 200, body: 'Simulated response.' })
    default: return JSON.stringify({ simulated: true, executed: false, intent: context.userIntent.action })
  }
}
