import { expect, test } from 'vitest'
import { findAdminFunctions } from '../src/contract/adminFunctions'

const abiWith = (names: string[]) => names.map((name) => ({
  type: 'function', name, inputs: [], outputs: [], stateMutability: 'nonpayable',
}))

test('maps risky function names to flags in ABI order', () => {
  expect(findAdminFunctions(abiWith(['mint', 'pause', 'setTax', 'blacklist', 'sweep']))).toEqual([
    { name: 'mint', flag: 'HIDDEN_MINT' },
    { name: 'pause', flag: 'PAUSE_OR_FREEZE_FUNDS' },
    { name: 'setTax', flag: 'MUTABLE_OR_HIGH_TAX' },
    { name: 'blacklist', flag: 'HONEYPOT_OR_BLACKLIST' },
    { name: 'sweep', flag: 'PERMIT_OR_DRAINER_PATTERN' },
  ])
})

test.each(['cap', 'maxSupply', 'CAP', 'MAXSUPPLY'])('a mint with %s is not flagged', (cap) => {
  expect(findAdminFunctions(abiWith(['mint', cap]))).toEqual([])
})

test.each([
  ['mintTo', 'HIDDEN_MINT'], ['FREEZEAccount', 'PAUSE_OR_FREEZE_FUNDS'],
  ['lockFunds', 'PAUSE_OR_FREEZE_FUNDS'], ['disableTransfers', 'PAUSE_OR_FREEZE_FUNDS'],
  ['setFee', 'MUTABLE_OR_HIGH_TAX'], ['updateFee', 'MUTABLE_OR_HIGH_TAX'],
  ['setSellFee', 'MUTABLE_OR_HIGH_TAX'], ['setBuyFee', 'MUTABLE_OR_HIGH_TAX'],
  ['addToBlacklist', 'HONEYPOT_OR_BLACKLIST'], ['ban', 'HONEYPOT_OR_BLACKLIST'],
  ['setBot', 'HONEYPOT_OR_BLACKLIST'], ['excludeFromTransfer', 'HONEYPOT_OR_BLACKLIST'],
  ['transferFromAny', 'PERMIT_OR_DRAINER_PATTERN'], ['drain', 'PERMIT_OR_DRAINER_PATTERN'],
  ['multicallTransferFrom', 'PERMIT_OR_DRAINER_PATTERN'],
])('%s is matched by prefix', (name, flag) => {
  expect(findAdminFunctions(abiWith([name]))).toEqual([{ name, flag }])
})

test('view and pure functions, events, and non-prefix names are ignored', () => {
  expect(findAdminFunctions([
    ...abiWith(['isPaused', 'remint']),
    { ...abiWith(['mint'])[0], stateMutability: 'view' },
    { ...abiWith(['sweep'])[0], stateMutability: 'pure' },
    { type: 'event', name: 'Mint', inputs: [], anonymous: false },
  ])).toEqual([])
})

test('an event named cap does not suppress a mint finding', () => {
  expect(findAdminFunctions([...abiWith(['mint']), { type: 'event', name: 'cap' }]))
    .toEqual([{ name: 'mint', flag: 'HIDDEN_MINT' }])
})

test.each([undefined, null, {}, 'abi', 42, [null, {}, { type: 'function', name: 42 }]])(
  'malformed input %j does not throw', (abi) => expect(findAdminFunctions(abi)).toEqual([]),
)
