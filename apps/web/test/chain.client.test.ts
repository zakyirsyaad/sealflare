import { afterEach, expect, test } from 'vitest'
import { clearRpcClient, getRpcClient } from '../server/chain'

afterEach(() => {
  clearRpcClient()
  delete process.env.RPC_URLS
})

test('one client serves every read of the process, so a page view does not open a connection per call', () => {
  process.env.RPC_URLS = 'http://127.0.0.1:8545'
  clearRpcClient()
  const first = getRpcClient()
  expect(getRpcClient()).toBe(first)
})

test('a different set of RPC urls gives a different client', () => {
  process.env.RPC_URLS = 'http://127.0.0.1:8545'
  clearRpcClient()
  const first = getRpcClient()
  process.env.RPC_URLS = 'http://127.0.0.1:9545'
  expect(getRpcClient()).not.toBe(first)
})
