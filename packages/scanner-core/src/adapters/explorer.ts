// API checked 2026-11-25: https://docs.etherscan.io/api-reference/endpoint/getsourcecode
// Errors: https://docs.etherscan.io/resources/common-error-messages
import { z } from 'zod'
import { CHAIN_ID_MAINNET } from '@sealflare/shared/rules'
import { AddressSchema, type ExplorerAdapter } from '@sealflare/shared/schemas'
import { Abi } from '../contract/abi'
import { httpUrl, requestJson } from './http'

const Row = z.object({ SourceCode: z.string(), ABI: z.string(), ContractName: z.string(), ContractFileName: z.string().optional() })
const Reply = z.object({ status: z.literal('1'), result: z.array(Row).length(1) })
const Sources = z.record(z.string(), z.object({ content: z.string() })).refine((files) => Object.keys(files).length > 0)

function sourceFiles(source: string, fallback: string) {
  if (!source.trimStart().startsWith('{')) return [{ path: fallback, content: source }]
  const text = source.startsWith('{{') && source.endsWith('}}') ? source.slice(1, -1) : source
  const parsed: unknown = JSON.parse(text)
  const standard = z.object({ sources: Sources }).safeParse(parsed)
  const files = standard.success ? standard.data.sources : Sources.parse(parsed)
  return Object.entries(files).map(([path, { content }]) => ({ path, content }))
}

export function createExplorerAdapter(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }): ExplorerAdapter {
  if (!options.apiKey.trim()) throw Error('An Etherscan V2 API key is required.')
  const base = httpUrl(options.baseUrl ?? 'https://api.etherscan.io/v2/api')
  const fetcher = options.fetch ?? fetch
  return { getSource: async (input) => {
    const address = AddressSchema.parse(input)
    try {
      const url = new URL(base)
      for (const [key, value] of Object.entries({ chainid: String(CHAIN_ID_MAINNET), module: 'contract',
        action: 'getsourcecode', address, apikey: options.apiKey })) url.searchParams.set(key, value)
      const { status, body } = await requestJson(fetcher, url.toString(), {}, 8_388_608)
      if (status !== 200) return null
      const row = Reply.parse(body).result[0]!
      if (!row.SourceCode.trim() && row.ABI === 'Contract source code not verified') return { verified: false, files: [] }
      if (!row.SourceCode.trim()) return null
      const abi: unknown = JSON.parse(row.ABI)
      Abi.parse(abi)
      return { verified: true, files: sourceFiles(row.SourceCode, row.ContractFileName || `${row.ContractName || 'Contract'}.sol`), abi }
    } catch {
      return null
    }
  } }
}
