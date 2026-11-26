import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { numberToHex, type Hex } from 'viem'
import { TRUST_TIERS } from '@sealflare/shared/rules'

const CORE = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TARGET = `0x${'ab'.repeat(32)}` as Hex
const HEAD = 5_000_000n

/**
 * A node that is a few blocks behind the head of the chain, the way a public node lags.
 *
 * A call for a block the node does not have fails, the way a node that is behind answers.
 */
const NODE_HEAD = HEAD - 2n

type Call = { id: number; method: string; params: unknown[] }
const state = { calls: [] as Call[], requests: 0, sizes: [] as number[] }

function answer(call: Call): unknown {
  if (call.method === 'eth_blockNumber') return numberToHex(HEAD)
  if (call.method === 'eth_call') {
    const block = call.params[1] as string
    if (block !== 'latest' && BigInt(block) > NODE_HEAD) {
      throw Object.assign(new Error('header not found'), { rpc: -32000 })
    }
    state.calls.push(call)
    // The tier is the second of the list, COMMUNITY_SAFE.
    return `0x${'0'.repeat(62)}01`
  }
  throw Object.assign(new Error(`unexpected ${call.method}`), { rpc: -32601 })
}

let server: Server

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      state.requests += 1
      const parsed = JSON.parse(body) as Call | Call[]
      const calls = Array.isArray(parsed) ? parsed : [parsed]
      state.sizes.push(calls.length)
      const answers = calls.map(call => {
        try {
          return { jsonrpc: '2.0', id: call.id, result: answer(call) }
        } catch (error) {
          const { rpc, message } = error as { rpc: number; message: string }
          return { jsonrpc: '2.0', id: call.id, error: { code: rpc, message } }
        }
      })
      response.end(JSON.stringify(Array.isArray(parsed) ? answers : answers[0]))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.RPC_URLS = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({ chainId: 56, agentId: CORE, core: CORE })
})

afterAll(() => {
  server.close()
  delete process.env.RPC_URLS
  delete process.env.NEXT_PUBLIC_ADDRESSES_BSC
})

beforeEach(() => {
  state.calls = []
  state.requests = 0
  state.sizes = []
})

async function reader() {
  return (await import('../server/chain')).getChainReader()
}

/**
 * The tests of this file talk to a node of their own, so they need a moment more than a test
 * that only reads a value.
 */
const TIMEOUT = 20_000

describe('the tier of a target, read from a node that lags behind the head', () => {
  test('the tier is read a few blocks below the head, so a node that lags can answer', async () => {
    const tier = await (await reader()).tier(TARGET)

    expect(tier).toBe(TRUST_TIERS[1])
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]!.params[1]).toBe(numberToHex(HEAD - 3n))
  }, TIMEOUT)

  test('the block of the tiers is read once, so every tier of an answer comes from it', async () => {
    const block = await (await reader()).tierBlockNumber()

    expect(block).toBe(HEAD - 3n)
  }, TIMEOUT)

  test('a tier at a fixed block is read at that block', async () => {
    const tier = await (await reader()).tierAt(TARGET, 100n)

    expect(tier).toBe(TRUST_TIERS[1])
    expect(state.calls[0]!.params[1]).toBe(numberToHex(100n))
  }, TIMEOUT)

  test('the reads of a list of targets leave in small batches, because a provider may refuse a large one', async () => {
    const chain = await reader()
    const targets = Array.from({ length: 25 }, (_, index) => `0x${String(index + 1).padStart(64, '0')}` as Hex)

    await Promise.all(targets.map(targetId => chain.tierAt(targetId, 100n)))

    expect(state.calls).toHaveLength(25)
    // The keyless endpoint of viem takes 25 calls and a free plan of another provider takes 3, so
    // a batch of 100 would be refused by both. No request holds more than ten calls.
    expect(Math.max(...state.sizes)).toBeLessThanOrEqual(10)
    expect(state.requests).toBeGreaterThan(1)
  }, TIMEOUT)
})
