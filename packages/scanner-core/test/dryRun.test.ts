import { expect, test } from 'vitest'
import { BaseError, ExecutionRevertedError, type Hex } from 'viem'
import { dryRun } from '../src/contract/dryRun'
import { ADDRESS, cleanRpc, transferData, word } from './contract.fixtures'

test('a token dry run simulates a zero transfer to itself from itself', async () => {
  expect(await dryRun(ADDRESS, cleanRpc())).toEqual({ check: { id: 'dry_run', status: 'passed' }, findings: [] })
})

test('a missing token method skips the dry run', async () => {
  const rpc = cleanRpc()
  rpc.call = async () => { throw new ExecutionRevertedError() }
  expect((await dryRun(ADDRESS, rpc)).check.status).toBe('skipped')
})

test('a transfer revert flags HONEYPOT_OR_BLACKLIST', async () => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => {
    if (tx.data === transferData) throw new BaseError('Call failed', { cause: new ExecutionRevertedError() })
    return call(tx)
  }
  const result = await dryRun(ADDRESS, rpc)
  expect(result.check.status).toBe('flagged')
  expect(result.findings).toMatchObject([{ checkId: 'dry_run', flag: 'HONEYPOT_OR_BLACKLIST' }])
})

test.each(['0x313ce567', transferData])('a transport failure at %s fails the check without alleging a honeypot', async (data) => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => { if (tx.data === data) throw Error('Network down'); return call(tx) }
  expect(await dryRun(ADDRESS, rpc)).toMatchObject({ check: { status: 'failed' }, findings: [] })
})

test.each<Hex>(['0x', '0x12', word(256n)])('invalid decimals response %s cannot pass', async (response) => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => tx.data === '0x313ce567' ? response : call(tx)
  expect((await dryRun(ADDRESS, rpc)).check.status).not.toBe('passed')
})

test.each<Hex>(['0x', word(1n)])('a non-reverting transfer returning %s passes', async (response) => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => tx.data === transferData ? response : call(tx)
  expect((await dryRun(ADDRESS, rpc)).check.status).toBe('passed')
})

test('a transfer returning false is flagged', async () => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => tx.data === transferData ? word(0n) : call(tx)
  expect((await dryRun(ADDRESS, rpc)).check.status).toBe('flagged')
})

test('malformed transfer output fails the check', async () => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => tx.data === transferData ? '0x1234' : call(tx)
  expect((await dryRun(ADDRESS, rpc)).check.status).toBe('failed')
})
