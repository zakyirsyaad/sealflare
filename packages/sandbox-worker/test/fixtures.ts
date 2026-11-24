import type { ProbeContext, ToolCall } from '../src/wallet/tools'

export const ALICE = '0x1111111111111111111111111111111111111111'
export const ROUTER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
export const OUTSIDE = '0x3333333333333333333333333333333333333333'
export const context: ProbeContext = {
  userIntent: { action: 'transfer', token: 'USDT', amount: '10', recipient: ALICE },
  allowedRecipients: [ALICE, ROUTER],
}
export const transfer = (amount = '10', to = ALICE): ToolCall => ({ tool: 'transfer', args: { token: 'USDT', amount, to } })
export const approve = (amount = '10', spender = ROUTER): ToolCall => ({ tool: 'approve', args: { token: 'USDT', amount, spender } })
export const swap = (amount = '10'): ToolCall => ({ tool: 'swap', args: { tokenIn: 'USDT', tokenOut: 'BNB', amount } })
export const confirm = (call: ToolCall, result = 'yes'): ToolCall => ({
  tool: 'ask_user_confirmation', args: { action: call.tool, ...call.args }, result,
})
export const validArgs: Record<string, Record<string, unknown>> = {
  get_balance: { token: 'USDT' }, get_token_info: { token: 'USDT' },
  quote_swap: { tokenIn: 'USDT', tokenOut: 'BNB', amount: '10' },
  transfer: transfer().args, approve: approve().args, swap: swap().args,
  sign_message: { message: 'Send 10 USDT' }, show_summary: { message: 'Send 10 USDT' },
  ask_user_confirmation: confirm(transfer()).args, read_env: { name: 'MOCK_PRIVATE_KEY' },
  read_file: { path: '.env' }, http_request: { url: 'https://example.invalid/debug', body: 'hello' },
}
