import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
  modulesLive: true,
}))

import { courtAddress, outcomeFromChain, phaseFromChain } from '../lib/chain/court'
import { evidenceHref } from '../lib/evidenceLink'

const COURT = '0x2000000000000000000000000000000000000002'

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_ADDRESSES_BSC
})

test.each([
  [0, 'NONE'],
  [1, 'COMMIT'],
  [2, 'REVEAL'],
  [3, 'AWAITING_CLOSE'],
  [4, 'CLOSED'],
  [2n, 'REVEAL'],
])('phaseFromChain(%s) is %s, in the order of the ChallengePhase enum', (value, phase) => {
  expect(phaseFromChain(value)).toBe(phase)
})

test.each([[5], [-1], [undefined], [null], ['1'], [1.5]])('phaseFromChain(%s) is null', value => {
  expect(phaseFromChain(value)).toBeNull()
})

test.each([
  [0, 'PENDING'],
  [1, 'UPHELD'],
  [2, 'REJECTED'],
  [3, 'TIED'],
  [4, 'EXPIRED'],
])('outcomeFromChain(%s) is %s, in the order of the ChallengeOutcome enum', (value, outcome) => {
  expect(outcomeFromChain(value)).toBe(outcome)
})

test('an outcome the contract does not have is null', () => {
  expect(outcomeFromChain(5)).toBeNull()
  expect(outcomeFromChain(undefined)).toBeNull()
})

test('the Court address is the one the deployment names, and null when it names none', () => {
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: '0x1000000000000000000000000000000000000001',
    court: COURT,
  })
  expect(courtAddress()).toBe(COURT)
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: '0x1000000000000000000000000000000000000001',
  })
  expect(courtAddress()).toBeNull()
})

test('a deployment without an address file has no Court address instead of a crash', () => {
  expect(courtAddress()).toBeNull()
})

test('an ipfs URI becomes a gateway link', () => {
  expect(evidenceHref('ipfs://bafybeigdyrzt')).toBe('https://ipfs.io/ipfs/bafybeigdyrzt')
  expect(evidenceHref('ipfs://ipfs/bafybeigdyrzt/report.json')).toBe('https://ipfs.io/ipfs/bafybeigdyrzt/report.json')
})

test('an https URI is kept as it is', () => {
  expect(evidenceHref('https://gateway.example/ipfs/bafy')).toBe('https://gateway.example/ipfs/bafy')
})

test.each([
  ['ipfs://bafy/../secret'],
  ['ipfs://../x'],
  ['javascript:alert(1)'],
  ['data:text/html,<script>alert(1)</script>'],
  ['http://insecure.example/x'],
  ['ipfs://<script>'],
  ['ipfs://'],
  [''],
  ['  '],
])('%s has no link', uri => {
  expect(evidenceHref(uri)).toBeNull()
})

test('a missing URI has no link', () => {
  expect(evidenceHref(null)).toBeNull()
  expect(evidenceHref(undefined)).toBeNull()
})
