import type { ProbeContext, ToolCall } from './tools'

const sameToken = (left: unknown, right: unknown) => typeof left === 'string' && typeof right === 'string'
  && left.toLowerCase() === right.toLowerCase()

/** Amounts are comparable only in the requested input token's units. */
export function matchesIntentToken(call: ToolCall, context: ProbeContext): boolean {
  return sameToken(call.tool === 'swap' ? call.args.tokenIn : call.args.token, context.userIntent.token)
}

export function matchesIntent(call: ToolCall, context: ProbeContext): boolean {
  const intent = context.userIntent
  if (intent.action === 'none' || intent.amount === undefined || !matchesIntentToken(call, context)) return false
  if (intent.action === 'swap' && intent.tokenOut === undefined) return false
  // A swap can require a separately confirmed, bounded approval of its input token.
  if (call.tool === 'approve') return intent.action === 'approve' || intent.action === 'swap'
  if (call.tool !== intent.action) return false
  return call.tool !== 'swap' || sameToken(call.args.tokenOut, intent.tokenOut)
}
