// API checked 2026-11-25: https://ethereum.org/en/developers/docs/apis/json-rpc/
// Revert error type: https://viem.sh/docs/contract/simulateContract
import { ExecutionRevertedError } from 'viem'
import { z } from 'zod'
import { AddressSchema, Bytes32Schema, ScanError, type RpcAdapter } from '@sealflare/shared/schemas'
import { Bytecode } from '../contract/bytecode'
import { httpUrl, requestJson } from './http'

const Reply = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(1), result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional() })
const Tx = z.object({ to: AddressSchema, from: AddressSchema.optional(), data: Bytecode,
  value: z.bigint().nonnegative().optional() })

function reverted(code: number, message: string): boolean {
  return code === 3 || ([-32000, -32015].includes(code) && /execution reverted/i.test(message))
}

export function createRpcAdapter(urls: readonly string[], options: { timeoutMs?: number; fetch?: typeof fetch } = {}): RpcAdapter {
  if (!urls.length) throw Error('At least one BNB Chain RPC URL is required.')
  const providers = urls.map((url) => httpUrl(url).toString())
  const timeout = z.number().int().positive().parse(options.timeoutMs ?? 1500)
  const fetcher = options.fetch ?? fetch
  async function request<T>(method: string, params: unknown[], parse: (value: unknown) => T): Promise<T> {
    for (const url of providers) {
      try {
        const { status, body } = await requestJson(fetcher, url, { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }, 524_288, timeout)
        if (status !== 200) throw Error('Provider unavailable.')
        const reply = Reply.parse(body)
        if (reply.error) {
          if (method === 'eth_call' && reverted(reply.error.code, reply.error.message)) throw new ExecutionRevertedError()
          throw Error('RPC request failed.')
        }
        if (!('result' in reply)) throw Error('Missing RPC result.')
        return parse(reply.result)
      } catch (error) {
        if (error instanceof ExecutionRevertedError) throw error
      }
    }
    throw new ScanError('RPC_UNAVAILABLE', 'BNB Chain could not be reached. No verdict was produced.')
  }
  return {
    getCode: async (address) => request('eth_getCode', [AddressSchema.parse(address), 'latest'], (value) => Bytecode.parse(value)),
    getStorageAt: async (address, slot) => request('eth_getStorageAt',
      [AddressSchema.parse(address), Bytes32Schema.parse(slot), 'latest'], (value) => Bytes32Schema.parse(value)),
    call: async (input) => {
      const { value, ...tx } = Tx.parse(input)
      return request('eth_call', [{ ...tx, ...(value === undefined ? {} : { value: `0x${value.toString(16)}` }) }, 'latest'],
        (result) => Bytecode.parse(result))
    },
    getBlockNumber: async () => request('eth_blockNumber', [], (value) => BigInt(z.string().regex(/^0x[0-9a-fA-F]+$/).parse(value))),
  }
}
