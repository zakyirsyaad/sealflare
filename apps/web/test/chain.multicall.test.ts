import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, numberToHex, type Hex } from 'viem'
import { TRUST_TIERS } from '@sealflare/shared/rules'

const CORE = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'
/** Above the block Multicall3 was deployed at on BSC, so viem groups the reads. */
const HEAD = 20_000_000n
const TIER_WORD: Hex = `0x${'0'.repeat(62)}01`

type Call = { id: number; method: string; params: Array<unknown> }
const state = { direct: 0, aggregated: 0, subCalls: 0, sizes: [] as number[] }

function answer(call: Call): unknown {
  if (call.method === 'eth_blockNumber') return numberToHex(HEAD)
  if (call.method !== 'eth_call') throw Object.assign(new Error(`unexpected ${call.method}`), { rpc: -32601 })
  const { to, data } = call.params[0] as { to: string; data: Hex }
  if (to.toLowerCase() !== MULTICALL3) {
    state.direct += 1
    return TIER_WORD
  }
  const decoded = decodeFunctionData({ abi: multicall3Abi, data })
  if (decoded.functionName !== 'aggregate3') throw Object.assign(new Error('unexpected multicall'), { rpc: -32601 })
  const calls = decoded.args[0]
  state.aggregated += 1
  state.subCalls += calls.length
  return encodeFunctionResult({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    result: calls.map(() => ({ success: true, returnData: TIER_WORD })),
  })
}

let server: Server

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
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
  state.direct = 0
  state.aggregated = 0
  state.subCalls = 0
  state.sizes = []
})

async function reader() {
  return (await import('../server/chain')).getChainReader()
}

describe('the tiers of a list, read through Multicall3', () => {
  test('the reads of one block are grouped into Multicall3 calls and not sent one by one', async () => {
    const chain = await reader()
    const targets = Array.from({ length: 30 }, (_, index) => `0x${String(index + 1).padStart(64, '0')}` as Hex)

    const tiers = await Promise.all(targets.map(targetId => chain.tierAt(targetId, HEAD - 10n)))

    expect(tiers.every(tier => tier === TRUST_TIERS[1])).toBe(true)
    expect(state.direct).toBe(0)
    expect(state.subCalls).toBe(30)
    expect(state.aggregated).toBeLessThan(30)
    // Whatever the transport does with the calls, no request is larger than its small batch.
    expect(Math.max(...state.sizes)).toBeLessThanOrEqual(10)
  }, 20_000)
})
