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
const state = {
  logRanges: [] as Array<[bigint, bigint]>,
  blockReads: 0,
  failRangeStartingAt: null as bigint | null,
  head: HEAD,
  logs: [] as ReturnType<typeof attestedLog>[],
}

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
  if (method === 'eth_blockNumber') return numberToHex(state.head)
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
    return state.logs.filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to)
  }
  throw Object.assign(new Error(`unexpected ${method}`), { rpc: -32601 })
}

let server: Server

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      const parsed = JSON.parse(body) as (Request & { id: number }) | Array<Request & { id: number }>
      const calls = Array.isArray(parsed) ? parsed : [parsed]
      // The transport of the chain puts the calls that come at the same time into one request, so
      // the node answers a list of calls as well as a single one.
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

beforeEach(async () => {
  state.logRanges = []
  state.blockReads = 0
  state.failRangeStartingAt = null
  state.head = HEAD
  state.logs = [...LOGS]
  const { clearEvidenceCache } = await import('../server/chain')
  clearEvidenceCache()
})

async function reader() {
  return (await import('../server/chain')).getChainReader()
}

describe('the evidence of a target, read through a public-RPC-like node', () => {
  test('an attestation a million blocks old is found, from the creation block, in ranges the node accepts', async () => {
    const rows = await (await reader()).evidence(TARGET, timestampOf(CREATED_BLOCK), 2)
    expect(rows.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://new'])
    expect(state.logRanges[0]![0]).toBe(CREATED_BLOCK)
    expect(state.logRanges.at(-1)![1]).toBe(HEAD)
    for (const [from, to] of state.logRanges) expect(to - from + 1n).toBeLessThanOrEqual(LOG_RANGE)
    const ordered = [...state.logRanges].sort((a, b) => Number(a[0] - b[0]))
    ordered.slice(1).forEach(([from], i) => expect(from).toBe(ordered[i]![1] + 1n))
  })

  test('one range that fails fails the whole read instead of returning a list with a hole', async () => {
    state.failRangeStartingAt = CREATED_BLOCK + LOG_RANGE
    await expect((await reader()).evidence(TARGET, timestampOf(CREATED_BLOCK), 2)).rejects.toThrow()
  })

  test('the creation block is searched once per process, not on every page view', async () => {
    const chain = await reader()
    const unseen = `0x${'ef'.repeat(32)}` as Hex
    await chain.evidence(unseen, timestampOf(CREATED_BLOCK), 0)
    const first = state.blockReads
    expect(first).toBeGreaterThan(0)
    await chain.evidence(unseen, timestampOf(CREATED_BLOCK), 0)
    expect(state.blockReads).toBe(first)
  })

  test('a second view of the same target reads the tail above the confirmed block again, and keeps the rows', async () => {
    const chain = await reader()
    const target = `0x${'12'.repeat(32)}` as Hex
    await chain.evidence(target, timestampOf(CREATED_BLOCK), 0)
    const first = state.logRanges.length
    await chain.evidence(target, timestampOf(CREATED_BLOCK), 0)
    // The head has not moved, but the blocks above the confirmed one are read again, because a log
    // that a node did not return for them has to be read a second time.
    expect(state.logRanges.length).toBe(first + 1)
    expect(state.logRanges.at(-1)![0]).toBe(HEAD - 11n)
  })

  test('a later view reads only the blocks that came after the last one and keeps the old rows', async () => {
    const chain = await reader()
    const target = TARGET
    const first = await chain.evidence(target, timestampOf(CREATED_BLOCK), 2)
    expect(first.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://new'])
    const ranges = state.logRanges.length
    state.logs = [...state.logs, attestedLog(HEAD + 500n, 2, 'ipfs://later')]
    state.head = HEAD + 1_000n
    const rows = await chain.evidence(target, timestampOf(CREATED_BLOCK), 3)
    // The read starts above the confirmed block of the last read and covers the new blocks.
    expect(state.logRanges[ranges]![0]).toBe(HEAD - 11n)
    expect(state.logRanges.at(-1)![1]).toBe(HEAD + 1_000n)
    expect(rows.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://new', 'ipfs://later'])
  })

  test('a failed delta leaves the cursor where it was, so the same blocks are read again', async () => {
    const chain = await reader()
    const target = `0x${'56'.repeat(32)}` as Hex
    await chain.evidence(target, timestampOf(CREATED_BLOCK), 0)
    // The head moves, so a cursor that advanced on the failure would start somewhere else.
    state.head = HEAD + 1_000n
    state.failRangeStartingAt = HEAD - 11n
    await expect(chain.evidence(target, timestampOf(CREATED_BLOCK), 0)).rejects.toThrow()
    state.failRangeStartingAt = null
    const before = state.logRanges.length
    await chain.evidence(target, timestampOf(CREATED_BLOCK), 0)
    // The failed range is read again, because the cursor never moved past it.
    expect(state.logRanges[before]![0]).toBe(HEAD - 11n)
    expect(state.logRanges[before]![1]).toBe(HEAD + 1_000n)
  })

  test('a log that is missing leaves a hole, and the page is told the log is not complete', async () => {
    state.logs = [attestedLog(CREATED_BLOCK + 10n, 0, 'ipfs://old')]
    await expect((await reader()).evidence(TARGET, timestampOf(CREATED_BLOCK), 2)).rejects.toThrow(/not complete/)
  })

  test('a hole heals: the next read starts at the creation block again, because the cache was dropped', async () => {
    const chain = await reader()
    state.logs = [attestedLog(CREATED_BLOCK + 10n, 0, 'ipfs://old')]
    await expect(chain.evidence(TARGET, timestampOf(CREATED_BLOCK), 2)).rejects.toThrow(/not complete/)
    state.logs = [...LOGS]
    const before = state.logRanges.length
    const rows = await chain.evidence(TARGET, timestampOf(CREATED_BLOCK), 2)
    expect(rows.map(row => row.evidenceURI)).toEqual(['ipfs://old', 'ipfs://new'])
    // The whole history is read again, so the log that was missing is found this time.
    expect(state.logRanges[before]![0]).toBe(CREATED_BLOCK)
  })

  test('the tail above a block is read on its own, for the votes that are not final yet', async () => {
    const rows = await (await reader()).evidenceFrom(TARGET, HEAD - 100n)
    expect(rows.map(row => row.evidenceURI)).toEqual(['ipfs://new'])
    expect(state.logRanges[0]![0]).toBe(HEAD - 100n)
    expect(state.logRanges.at(-1)![1]).toBe(HEAD)
  })

  test('a target too old to be read this way is refused, not read halfway', async () => {
    const old = `0x${'cd'.repeat(32)}` as Hex
    // The head is far enough that the span from the first block is wider than the window.
    state.head = 20_000_000n
    await expect((await reader()).evidence(old, T0, 0)).rejects.toThrow(RangeError)
  })
})

describe('the binding of a target', () => {
  const publisherBound = coreAbi.find(item => item.type === 'event' && item.name === 'PublisherBound')!

  const SPONSOR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const current = { publisher: GUARDIAN as Hex, role: 'VERIFIED_PUBLISHER' as const }

  /** The role is the index of the enum of Core: 1 is a sponsor, 2 is the verified publisher. */
  function boundLog(block: bigint, publisher: string = GUARDIAN, role = 2) {
    const data = encodeAbiParameters(
      publisherBound.inputs.filter(input => !input.indexed),
      [role, 0] as never,
    )
    const topics = encodeEventTopics({
      abi: coreAbi,
      eventName: 'PublisherBound',
      args: { targetId: TARGET, publisher },
    } as never)
    return {
      address: CORE.toLowerCase(), blockHash: `0x${'11'.repeat(32)}`, blockNumber: numberToHex(block), data, logIndex: '0x0',
      removed: false, topics, transactionHash: `0x${'9'.repeat(64)}`, transactionIndex: '0x0',
    }
  }

  test('a confirmed binding is read once while the target still reports the same publisher', async () => {
    state.logs = [boundLog(HEAD - 100n)] as never
    const chain = await reader()
    const first = await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    expect(first?.publisher.toLowerCase()).toBe(GUARDIAN.toLowerCase())
    const reads = state.logRanges.length
    expect(reads).toBeGreaterThan(0)
    await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    expect(state.logRanges.length).toBe(reads)
  })

  test('a binding that is too close to the head is read again, because the block can still change', async () => {
    state.logs = [boundLog(HEAD - 3n)] as never
    const chain = await reader()
    await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    const reads = state.logRanges.length
    await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    expect(state.logRanges.length).toBeGreaterThan(reads)
  })

  test('a verified publisher that replaces another one is read from the log, not from the cache', async () => {
    state.logs = [boundLog(HEAD - 100n)] as never
    const chain = await reader()
    await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    // A fresh proof of the current owner() binds the target again, and the latest event wins.
    state.logs = [boundLog(HEAD - 100n), boundLog(HEAD - 50n, SPONSOR)] as never
    const replaced = await chain.binding(TARGET, timestampOf(CREATED_BLOCK), {
      publisher: SPONSOR as Hex,
      role: 'VERIFIED_PUBLISHER',
    })
    expect(replaced?.publisher.toLowerCase()).toBe(SPONSOR.toLowerCase())
  })

  test('a sponsor that gives way to the verified publisher is read from the log, not from the cache', async () => {
    state.logs = [boundLog(HEAD - 100n, GUARDIAN, 1)] as never
    const chain = await reader()
    const sponsored = await chain.binding(TARGET, timestampOf(CREATED_BLOCK), { publisher: GUARDIAN as Hex, role: 'THIRD_PARTY_SPONSOR' })
    expect(sponsored?.role).toBe('THIRD_PARTY_SPONSOR')
    state.logs = [boundLog(HEAD - 100n, GUARDIAN, 1), boundLog(HEAD - 50n, GUARDIAN, 2)] as never
    const upgraded = await chain.binding(TARGET, timestampOf(CREATED_BLOCK), current)
    expect(upgraded?.role).toBe('VERIFIED_PUBLISHER')
  })
})
