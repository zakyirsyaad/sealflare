import { afterEach, expect, test, vi } from 'vitest'
import { ExecutionRevertedError } from 'viem'
import { CONTRACT_CHECK_IDS, ScanReport } from '@sealflare/shared/schemas'
import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { scanContract } from '../src/contract/scanContract'
import * as dryRunModule from '../src/contract/dryRun'
import { ADDRESS, IMPLEMENTATION, IMPLEMENTATION_SLOT, BEACON_SLOT, cleanRpc, clone,
  abiWith, explorerWith, transferData, word } from './contract.fixtures'

afterEach(() => vi.restoreAllMocks())
const scan = (rpc = cleanRpc(), explorer = explorerWith()) => scanContract(ADDRESS, {
  rpc, explorer, now: () => new Date('2026-11-25T00:00:00Z'),
})

test('an address without code throws NO_CODE_AT_ADDRESS', async () => {
  const rpc = cleanRpc(); rpc.getCode = async () => '0x'
  await expect(scan(rpc)).rejects.toMatchObject({ code: 'NO_CODE_AT_ADDRESS' })
})

test.each(['getCode', 'getBlockNumber'] as const)('%s failing throws RPC_UNAVAILABLE', async (method) => {
  const rpc = cleanRpc(); rpc[method] = async () => { throw Error('Provider down with secret') }
  await expect(scan(rpc)).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' })
  await expect(scan(rpc)).rejects.not.toThrow('secret')
})

test('a clean verified token produces a schema-valid SAFE report with exactly seven checks', async () => {
  const rpc = cleanRpc(); rpc.getCode = vi.fn(rpc.getCode)
  const report = await scan(rpc)
  expect(ScanReport.safeParse(report).success).toBe(true)
  expect(report.checks.map(({ id }) => id).sort()).toEqual([...CONTRACT_CHECK_IDS].sort())
  expect(report.suggestedVerdict).toBe('SAFE')
  expect(report.targetId).toBe(targetIdOfContract(ADDRESS))
  expect(report.source).toMatchObject({ blockNumber: '52000000' })
  expect(report.scannedAt).toBe('2026-11-25T00:00:00.000Z')
  expect(rpc.getCode).toHaveBeenCalledExactlyOnceWith(ADDRESS)
})

test('an unanswered explorer fails source verification and skips admin inspection', async () => {
  const report = await scan(cleanRpc(), { getSource: async () => null })
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'source_verified', status: 'failed' }))
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'admin_functions', status: 'skipped' }))
  expect(report.suggestedVerdict).toBe('CAUTION')
  expect(report.findings).toEqual([])
})

test('unverified source is flagged, and an untrusted ABI is not used', async () => {
  const report = await scan(cleanRpc(), { getSource: async () => ({ verified: false, files: [], abi: abiWith('mint') }) })
  expect(report.flags).toBe(FLAGS.UNVERIFIED_SOURCE)
  expect(report.suggestedVerdict).toBe('CAUTION')
})

test.each([undefined, null])('missing ABI %j skips admin inspection, never SAFE', async (abi) => {
  const report = await scan(cleanRpc(), explorerWith(abi === undefined ? undefined : abi))
  if (abi === undefined) {
    const missing = await scan(cleanRpc(), { getSource: async () => ({ verified: true, files: [] }) })
    expect(missing.checks).toContainEqual(expect.objectContaining({ id: 'admin_functions', status: 'skipped' }))
    expect(missing.suggestedVerdict).toBe('CAUTION')
  } else expect(report.suggestedVerdict).toBe('CAUTION')
})

test.each([{}, '[]', [null], [{ type: 'event', name: 'cap' }, 42],
  [{ type: 'event' }], [{ type: 'function', name: 'transfer', inputs: 'not-an-array' }],
  [{ ...abiWith('transfer')[0], inputs: [{ type: 'uint7' }] }],
  [{ ...abiWith('transfer')[0], inputs: [{ type: 'tuple' }] }],
])('malformed ABI %j fails admin inspection', async (abi) => {
  const report = await scan(cleanRpc(), explorerWith(abi))
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'admin_functions', status: 'failed' }))
  expect(report.suggestedVerdict).toBe('CAUTION')
})

test('risky admin functions yield findings and their exact combined flags', async () => {
  const report = await scan(cleanRpc(), explorerWith(abiWith('mint', 'setTax')))
  expect(report.flags).toBe(FLAGS.HIDDEN_MINT | FLAGS.MUTABLE_OR_HIGH_TAX)
  expect(report.suggestedVerdict).toBe('DANGER')
  expect(report.findings.map(({ location }) => location)).toEqual(['ABI:mint', 'ABI:setTax'])
})

test('a valid JSON ABI including tuples, events, errors and special functions can pass', async () => {
  const abi = [
    { ...abiWith('transfer')[0], inputs: [{ name: 'items', type: 'tuple[]', components: [{ type: 'uint256' }] }],
      outputs: [{ type: 'bool' }] },
    { type: 'event', name: 'Transfer', anonymous: false, inputs: [{ type: 'address', indexed: true }] },
    { type: 'error', name: 'Unauthorized', inputs: [] },
    { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
    { type: 'fallback', stateMutability: 'nonpayable' }, { type: 'receive', stateMutability: 'payable' },
  ]
  expect((await scan(cleanRpc(), explorerWith(abi))).suggestedVerdict).toBe('SAFE')
})

test.each(['eip1967', 'beacon'] as const)('%s records implementation and upgrade risk', async (standard) => {
  const rpc = cleanRpc()
  rpc.getCode = async (to) => to === ADDRESS ? '0x6000f4' : '0x00'
  rpc.getStorageAt = async (_to, slot) =>
    slot === (standard === 'eip1967' ? IMPLEMENTATION_SLOT : BEACON_SLOT) ? word(BigInt(IMPLEMENTATION)) : word(0n)
  const call = rpc.call
  rpc.call = async (tx) => tx.data === '0x5c60da1b' ? word(BigInt(IMPLEMENTATION)) : call(tx)
  const report = await scan(rpc)
  expect(report.flags).toBe(FLAGS.UPGRADEABLE_NO_TIMELOCK)
  expect(report.source).toMatchObject({ implementation: { standard, address: IMPLEMENTATION } })
  expect(report.suggestedVerdict).toBe('CAUTION')
})

test('unknown delegatecall is flagged UNPINNABLE_DELEGATECALL', async () => {
  const rpc = cleanRpc(); rpc.getCode = async () => '0x6000f4'
  expect((await scan(rpc)).flags).toBe(FLAGS.UNPINNABLE_DELEGATECALL)
})

test('a minimal proxy records its implementation without an upgradeable flag', async () => {
  const rpc = cleanRpc(); rpc.getCode = async (to) => to === ADDRESS ? clone : '0x00'
  const report = await scan(rpc)
  expect(report.source).toMatchObject({ implementation: { standard: 'eip1167', address: IMPLEMENTATION } })
  expect(report.flags).toBe(0)
})

test('a non-token skips dry run and cannot be SAFE', async () => {
  const rpc = cleanRpc(); rpc.call = async () => { throw new ExecutionRevertedError() }
  const report = await scan(rpc)
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'dry_run', status: 'skipped' }))
  expect(report.suggestedVerdict).toBe('CAUTION')
})

test('a reverting zero transfer flags a honeypot and suggests DANGER', async () => {
  const rpc = cleanRpc(), call = rpc.call
  rpc.call = async (tx) => { if (tx.data === transferData) throw new ExecutionRevertedError(); return call(tx) }
  expect((await scan(rpc)).flags).toBe(FLAGS.HONEYPOT_OR_BLACKLIST)
  expect((await scan(rpc)).suggestedVerdict).toBe('DANGER')
})

test('a throwing check fails without preventing the other checks', async () => {
  vi.spyOn(dryRunModule, 'dryRun').mockRejectedValue(Error('secret'))
  const report = await scan()
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'dry_run', status: 'failed' }))
  expect(report.checks.filter(({ status }) => status === 'passed')).toHaveLength(6)
  expect(report.suggestedVerdict).toBe('CAUTION')
  expect(JSON.stringify(report)).not.toContain('secret')
})

test('proxy inspection failure cannot classify delegatecall as a known standard', async () => {
  const rpc = cleanRpc(); rpc.getCode = async () => '0xf4'
  rpc.getStorageAt = async () => { throw Error('RPC down') }
  const report = await scan(rpc)
  expect(report.checks.filter(({ status }) => status === 'failed').map(({ id }) => id))
    .toEqual(['proxy_eip1967', 'proxy_beacon', 'proxy_eip1167', 'delegatecall_opcode'])
  expect(report.suggestedVerdict).toBe('CAUTION')
})

test('invalid address is rejected before I/O', async () => {
  const rpc = cleanRpc(); rpc.getCode = vi.fn(rpc.getCode)
  await expect(scanContract('0x1234', { rpc, explorer: explorerWith() })).rejects.toMatchObject({ code: 'INPUT_NOT_RECOGNIZED' })
  expect(rpc.getCode).not.toHaveBeenCalled()
})
