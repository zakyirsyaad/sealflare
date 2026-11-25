import { expect, test } from 'vitest'
import {
  ContractFunctionExecutionError, ContractFunctionRevertedError, UserRejectedRequestError,
  encodeErrorResult, type Abi,
} from 'viem'
import { coreAbi, courtAbi, vaultAbi } from '@sealflare/shared/abi'
import { copy } from '../lib/copy'
import { translateContractError } from '../lib/chain/errors'

function revert(abi: Abi, errorName: string, args: readonly unknown[] = []) {
  const data = encodeErrorResult({ abi, errorName, args } as never)
  const cause = new ContractFunctionRevertedError({ abi, data, functionName: 'call' })
  return new ContractFunctionExecutionError(cause, { abi, functionName: 'call' })
}

test('every custom error in the three ABIs has a sentence', () => {
  const names = [...coreAbi, ...courtAbi, ...vaultAbi].filter(item => item.type === 'error').map(item => item.name)
  expect(names.length).toBeGreaterThan(20)
  for (const name of new Set(names)) expect((copy.errors as Record<string, string>)[name], name).toBeTruthy()
})

test('no sentence contains an em dash, an emoji, or an exclamation mark', () => {
  for (const sentence of [...Object.values(copy.errors), ...Object.values(copy.jurorStatus)]) {
    expect(sentence).not.toMatch(/—|!|\p{Extended_Pictographic}/u)
  }
})

test('DailyLimitReached is translated with the reset time', () => {
  const resetsAt = BigInt(Date.UTC(2026, 10, 26, 0, 0) / 1000)
  const result = translateContractError(revert(coreAbi as Abi, 'DailyLimitReached', [resetsAt]))
  expect(result?.message).toBe('You have used all 5 attestations for today. The limit resets at 2026-11-26 00:00 UTC.')
  expect(result?.retry).toBe(false)
})

test('a rejection in the wallet returns null, so the panel shows no error', () => {
  expect(translateContractError(new UserRejectedRequestError(new Error('User denied')))).toBeNull()
})

test('a rejection wrapped inside another error is still a rejection', () => {
  const wrapped = new Error('Transaction failed', { cause: new UserRejectedRequestError(new Error('denied')) })
  expect(translateContractError(wrapped)).toBeNull()
})

test('an EIP-1193 rejection object with code 4001 is a rejection', () => {
  expect(translateContractError({ code: 4001, message: 'User rejected the request.' })).toBeNull()
})

test('an unknown revert gives a generic sentence and allows a retry', () => {
  const result = translateContractError(new Error('network down'))
  expect(result).toEqual({ message: copy.errors.unknown, retry: true })
})

test('a revert whose selector is not in the ABI is generic, not a crash', () => {
  const cause = new ContractFunctionRevertedError({ abi: coreAbi as Abi, data: '0xdeadbeef', functionName: 'call' })
  const result = translateContractError(new ContractFunctionExecutionError(cause, { abi: coreAbi as Abi, functionName: 'call' }))
  expect(result).toEqual({ message: copy.errors.unknown, retry: true })
})

test('a revert decoded with a different contract ABI is still translated', () => {
  const cause = new ContractFunctionRevertedError({
    abi: [] as Abi, data: encodeErrorResult({ abi: vaultAbi as Abi, errorName: 'BondAboveCap' }), functionName: 'call',
  })
  const result = translateContractError(new ContractFunctionExecutionError(cause, { abi: [] as Abi, functionName: 'call' }))
  expect(result?.message).toBe(copy.errors.BondAboveCap)
})

test('NotEligibleJuror names the specific reason', () => {
  const result = translateContractError(revert(courtAbi as Abi, 'NotEligibleJuror', [6]))
  expect(result?.message).toBe('You attested this target, so you cannot judge it.')
})

test.each([[1, 'NOT_AGENT_ID_HOLDER'], [2, 'PROFILE_TOO_NEW'], [3, 'NEGATIVE_SCORE'], [4, 'IS_CHALLENGER'], [5, 'IS_PUBLISHER'],
  [7, 'ALREADY_COMMITTED'], [8, 'NOT_IN_COMMIT_PHASE'], [9, 'JURY_FULL']])('NotEligibleJuror status %i has its own sentence (%s)', (status) => {
  const message = translateContractError(revert(courtAbi as Abi, 'NotEligibleJuror', [status]))?.message
  expect(message).toBeTruthy()
  expect(message).not.toBe(copy.errors.unknown)
})

test('WrongStake states the stake in BNB without floating point', () => {
  const result = translateContractError(revert(courtAbi as Abi, 'WrongStake', [10n ** 16n]))
  expect(result?.message).toBe('The stake must be exactly 0.01 BNB.')
})

test('WrongPhase names the current phase and InCooldown the end of the cooldown', () => {
  expect(translateContractError(revert(courtAbi as Abi, 'WrongPhase', [2]))?.message).toContain('reveal phase')
  const endsAt = BigInt(Date.UTC(2026, 11, 3, 12, 30) / 1000)
  expect(translateContractError(revert(courtAbi as Abi, 'InCooldown', [endsAt]))?.message).toContain('2026-12-03 12:30 UTC')
})

test('WithdrawalNotReady states when the withdrawal becomes available', () => {
  const at = BigInt(Date.UTC(2026, 11, 8, 9, 5) / 1000)
  expect(translateContractError(revert(vaultAbi as Abi, 'WithdrawalNotReady', [at]))?.message).toContain('2026-12-08 09:05 UTC')
})

test('a malformed revert argument gives the generic sentence instead of throwing', () => {
  expect(translateContractError(revert(coreAbi as Abi, 'DailyLimitReached', [2n ** 64n - 1n]))).toEqual({ message: copy.errors.unknown, retry: true })
  const hostile = { name: 'ContractFunctionRevertedError', data: { errorName: 'DailyLimitReached', args: ['x'] } }
  expect(translateContractError(hostile)).toEqual({ message: copy.errors.unknown, retry: true })
  const throwing = { get name(): string { throw new Error('boom') } }
  expect(translateContractError(throwing)).toEqual({ message: copy.errors.unknown, retry: true })
})

test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('an error named %s is generic, never a function or object', (errorName) => {
  const result = translateContractError({ name: 'ContractFunctionRevertedError', data: { errorName, args: [] } })
  expect(result).toEqual({ message: copy.errors.unknown, retry: true })
})

test('a WalletConnect rejection object with code 5000 is a rejection', () => {
  expect(translateContractError({ code: 5000, message: 'User rejected.' })).toBeNull()
})

test('WrongPhase with no open challenge reads naturally', () => {
  expect(translateContractError(revert(courtAbi as Abi, 'WrongPhase', [0]))?.message).toBe('This action is not available right now (no open challenge).')
})

test('a placeholder is never left unreplaced in any translated message', () => {
  const samples = [
    revert(coreAbi as Abi, 'DailyLimitReached', [1n]), revert(courtAbi as Abi, 'WrongStake', [1n]),
    revert(courtAbi as Abi, 'WrongPhase', [1]), revert(courtAbi as Abi, 'InCooldown', [1n]),
    revert(courtAbi as Abi, 'ChallengeAlreadyActive', [12n]), revert(vaultAbi as Abi, 'WithdrawalNotReady', [1n]),
  ]
  for (const error of samples) expect(translateContractError(error)?.message).not.toMatch(/[{}]/)
})
