import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, numberToHex, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { LOG_RANGE } from '../server/logRange'

const CORE = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TARGET = `0x${'ab'.repeat(32)}` as Hex
const GUARDIAN = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HEAD = 5_000_000n
const CREATED_BLOCK = 4_000_000n
const T0 = 1_700_000_000
const timestampOf = (block: bigint) => T0 + Number(block)

type Request = { method: string; params: unknown[] }
const state = { logRanges: [] as Array<[bigint, bigint]>, blockReads: 0, failRangeStartingAt: null as bigint | null }

const attested = coreAbi.find(item => item.type === 'event' && item.name === 'Attested')!

function attestedLog(block: bigint, index: number, uri: string) {
  const data = encodeAbiParameters(
    attested.inputs.filter(input => !input.indexed),
    [0, 0, 1, index, 1, `0x${'00'.repeat(32)}`, '0x', uri] as never,
  )
  const topics = encodeEventTopics({ abi: coreAbi, eventName: 'Attested', args: { targetId: TARGET, guardian: GUARDIAN } } as never)
  return {
    address: CORE.toLowerCase(), blockHash: `0x${'11'.repeat(32)}`, blockNumber: numberToHex(block), data, logIndex: '0x0',
    removed: false, topics, transactionHash: `0x${String(index + 1).repeat(64).slice(0, 64)}`, transactionIndex: '0x0',
  }
}

// One attestation far behind the head, which a 50,000 block window never reached, and one near the head.
const LOGS = [attestedLog(CREATED_BLOCK + 10n, 0, 'ipfs://old'), attestedLog(HEAD - 5n, 1, 'ipfs://new')]

function answer({ method, params }: Request): unknown {
  if (method === 'eth_blockNumber') return numberToHex(HEAD)
  if (method === 'eth_getBlockByNumber') {
    state.blockReads += 1
    const number = BigInt(params[0] as string)
    return {
      number: numberToHex(number), hash: `0x${'22'.repeat(32)}`, parentHash: `0x${'33'.repeat(32)}`, timestamp: numberToHex(timestampOf(number)),
      nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x0', gasUsed: '0x0', miner: GUARDIAN, transactions: [], uncles: [],
      size: '0x0', sha3Uncles: `0x${'44'.repeat(32)}`, stateRoot: `0x${'55'.repeat(32)}`, transactionsRoot: `0x${'66'.repeat(32)}`,
      receiptsRoot: `0x${'77'.repeat(32)}`, logsBloom: `0x${'00'.repeat(256)}`, extraData: '0x', mixHash: `0x${'88'.repeat(32)}`, totalDifficulty: '0x0',
    }
  }
  if (method === 'eth_getLogs') {
    const filter = params[0] as { fromBlock: string; toBlock: string; topics: Array<string | null> }
    const from = BigInt(filter.fromBlock)
    const to = BigInt(filter.toBlock)
    state.logRanges.push([from, to])
    if (to - from + 1n > LOG_RANGE) throw Object.assign(new Error('query returned more than the allowed block range'), { rpc: -32005 })
    if (from === state.failRangeStartingAt) throw Object.assign(new Error('upstream timeout'), { rpc: -32000 })
    if (filter.topics[1] !== TARGET) return []
    return LOGS.filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to)
  }
  throw Object.assign(new Error(`unexpected ${method}`), { rpc: -32601 })
}

let server: Server

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      const call = JSON.parse(body) as Request & { id: number }
      try {
        response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: answer(call) }))
      } catch (error) {
        const { rpc, message } = error as { rpc: number; message: string }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, error: { code: rpc, message } }))
      }
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
  state.logRanges = []
  state.blockReads = 0
  state.failRangeStartingAt = null
})

async function reader() {
  return (await import('../server/chain')).getChainReader()
}

describe('the evidence of a target, read through a public-RPC-like node', () => {
  test('an attestation a million blocks old is found, from the creation block, in ranges the node accepts', async () => {
    const rows = await (await reader()).evidence(TARGET, timestampOf(CREATED_BLOCK))
    expect(rows.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://new'])
    expect(state.logRanges[0]![0]).toBe(CREATED_BLOCK)
    expect(state.logRanges.at(-1)![1]).toBe(HEAD)
    for (const [from, to] of state.logRanges) expect(to - from + 1n).toBeLessThanOrEqual(LOG_RANGE)
    const ordered = [...state.logRanges].sort((a, b) => Number(a[0] - b[0]))
    ordered.slice(1).forEach(([from], i) => expect(from).toBe(ordered[i]![1] + 1n))
  })

  test('one range that fails fails the whole read instead of returning a list with a hole', async () => {
    state.failRangeStartingAt = CREATED_BLOCK + LOG_RANGE
    await expect((await reader()).evidence(TARGET, timestampOf(CREATED_BLOCK))).rejects.toThrow()
  })

  test('the creation block is searched once per process, not on every page view', async () => {
    const chain = await reader()
    const unseen = `0x${'ef'.repeat(32)}` as Hex
    await chain.evidence(unseen, timestampOf(CREATED_BLOCK))
    const first = state.blockReads
    expect(first).toBeGreaterThan(0)
    await chain.evidence(unseen, timestampOf(CREATED_BLOCK))
    expect(state.blockReads).toBe(first)
  })

  test('a target too old to be read this way is refused, not read halfway', async () => {
    const old = `0x${'cd'.repeat(32)}` as Hex
    await expect((await reader()).evidence(old, T0)).rejects.toThrow(RangeError)
  })
})
