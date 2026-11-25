import { expect, test } from 'vitest'
import { parseEnv } from '../src/env'

const base = {
  DATABASE_URL: 'postgres://sealflare:secret@127.0.0.1:5432/sealflare',
  RPC_URL: 'https://rpc.example.com',
  CORE_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  COURT_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  VAULT_ADDRESS: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
}

test('START_BLOCK is read as a block number', () => {
  const env = parseEnv({ ...base, CHAIN_ID: '97', START_BLOCK: '45123456' })
  expect(env.START_BLOCK).toBe(45123456n)
})

test('START_BLOCK is required on a public chain, so a deploy never scans from block 0 by accident', () => {
  expect(() => parseEnv({ ...base, CHAIN_ID: '56' })).toThrow(/START_BLOCK/)
  expect(() => parseEnv({ ...base, CHAIN_ID: '97' })).toThrow(/START_BLOCK/)
})

test('START_BLOCK defaults to 0 on the local chain only', () => {
  expect(parseEnv({ ...base, CHAIN_ID: '31337' }).START_BLOCK).toBe(0n)
})

test.each(['', ' ', '-1', '1.5', '0x10', 'abc', '1e6'])('START_BLOCK %j is refused', (value) => {
  expect(() => parseEnv({ ...base, CHAIN_ID: '97', START_BLOCK: value })).toThrow(/START_BLOCK/)
})
