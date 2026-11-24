import { expect, test } from 'vitest'
import { type Hex } from 'viem'
import { hasDelegatecall } from '../src/contract/bytecode'

// Literal vectors shared with contracts/test/BytecodeScan.t.sol.
test.each<[Hex, boolean]>([
  ['0x6000f4', true], ['0x61f4f400', false], ['0x60f4f4', true],
  ['0x7f0102', false], ['0x', false], ['0x00fef4000002', false],
  ['0x00fe5bf4000003', true], ['0x0000f4000003', true], ['0xf4ffff', true],
  ['0x5ff4', true], ['0x60fef4000003', true], ['0x60fe60f4f4000004', true],
  ['0xf40001', true],
])('hasDelegatecall(%s) is %s', (code, expected) => {
  expect(hasDelegatecall(code)).toBe(expected)
})

test('PUSH1 through PUSH32 payload bytes never count as opcodes', () => {
  for (let width = 1; width <= 32; width++) {
    const push = (0x5f + width).toString(16)
    expect(hasDelegatecall(`0x${push}${'f4'.repeat(width)}00`)).toBe(false)
    expect(hasDelegatecall(`0x${push}${'f4'.repeat(width)}f4`)).toBe(true)
  }
})

test('an EIP-1167 minimal proxy contains DELEGATECALL', () => {
  expect(hasDelegatecall('0x363d3d373d3d3d363d7300000000000000000000000000000000000000015af43d82803e903d91602b57fd5bf3')).toBe(true)
})

test('a JUMPDEST byte inside PUSH data still prevents metadata exclusion', () => {
  expect(hasDelegatecall('0x00fe605bf40003')).toBe(true)
})
