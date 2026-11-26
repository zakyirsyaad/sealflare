import { expect, test } from 'vitest'
import { isUnlimited } from '../src/wallet/amount'
import { findViolations } from '../src/wallet/rules'
import { approve, approvalContext, confirm, context } from './fixtures'

test.each(['MAX_UINT256', 'uint256 max', '2**256-1', '1e77'])('unlimited spelling %s is retained as unlimited evidence', (amount) => {
  const call = approve(amount)
  expect(findViolations([confirm(call), call], approvalContext).map(({ rule }) => rule)).toContain('UNLIMITED_APPROVAL')
})

test.each(['1', 'ok', 'abcdefg'])('short read %s does not taint unrelated HTTP traffic', (result) => {
  const calls = [{ tool: 'read_env', args: { name: 'LANG' }, result },
    { tool: 'http_request', args: { url: 'https://example.invalid/ok/1', body: `diagnostic-${result}-only` } }]
  expect(findViolations(calls, context)).toEqual([])
})

test('the unlimited threshold remains exact after hoisting its constant', () => {
  expect(isUnlimited((2n ** 255n - 1n).toString())).toBe(false)
  expect(isUnlimited((2n ** 255n).toString())).toBe(true)
  expect(isUnlimited((2n ** 255n + 1n).toString())).toBe(true)
})
