import { expect, test } from 'vitest'
import { addresses } from '../lib/chain/addresses'

const agentId = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const core = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const court = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
const vault = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'
const zero = '0x0000000000000000000000000000000000000000'
const file = (value: object) => JSON.stringify(value)

test('chain 31337 reads the local file', () => {
  const result = addresses(31337, { local: file({ agentId, core, court, vault }) })
  expect(result.core).toBe(core)
  expect(result.court).toBe(court)
  expect(result.vault).toBe(vault)
  expect(result.agentId.toLowerCase()).toBe(agentId)
})

test('chain 56 reads the BNB Chain file and maps the zero address to null', () => {
  const result = addresses(56, { bsc: file({ agentId, core, court: zero, vault: zero }) })
  expect(result.core).toBe(core)
  expect(result.court).toBeNull()
  expect(result.vault).toBeNull()
})

test('a file that omits court and vault means the modules are not deployed', () => {
  const result = addresses(56, { bsc: file({ agentId, core }) })
  expect(result.court).toBeNull()
  expect(result.vault).toBeNull()
})

test('chain 97 reads the BNB testnet file, which the founder deploys before mainnet', () => {
  const result = addresses(97, { bscTestnet: file({ chainId: 97, agentId, core }) })
  expect(result.core).toBe(core)
  expect(result.court).toBeNull()
  expect(() => addresses(97, { bsc: file({ chainId: 56, agentId, core }) })).toThrow(/97.*addresses\.bsc-testnet\.json/)
})

test('a missing file names the chain and how to produce it', () => {
  expect(() => addresses(31337, {})).toThrow(/31337.*pnpm chain/)
  expect(() => addresses(56, {})).toThrow(/56.*addresses\.bsc\.json/)
  expect(() => addresses(97, {})).toThrow(/97.*addresses\.bsc-testnet\.json/)
})

test('a malformed address or malformed JSON is rejected with the chain id', () => {
  expect(() => addresses(31337, { local: file({ agentId, core: '0x123', court, vault }) })).toThrow(/31337/)
  expect(() => addresses(31337, { local: '{not json' })).toThrow(/31337/)
})

test('a chain that is not supported is rejected', () => {
  expect(() => addresses(1 as 56, {})).toThrow(/not supported/)
})

test('a file written for another chain is rejected', () => {
  expect(() => addresses(56, { bsc: file({ chainId: 31337, agentId, core }) })).toThrow(/56/)
  expect(addresses(31337, { local: file({ chainId: 31337, agentId, core, court, vault }) }).core).toBe(core)
})

test('addresses are checksummed so equality checks do not depend on case', () => {
  const result = addresses(31337, { local: file({ agentId, core: core.toLowerCase(), court, vault }) })
  expect(result.core).toBe(core)
})
