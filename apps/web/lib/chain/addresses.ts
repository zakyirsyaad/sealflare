import { getAddress, zeroAddress, type Address } from 'viem'
import { z } from 'zod'

export type SupportedChainId = 56 | 31337
export type ContractAddresses = { agentId: Address; core: Address; court: Address | null; vault: Address | null }
export type AddressSources = { local?: string; bsc?: string }

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => getAddress(value.toLowerCase()))
const optionalModule = address.optional().transform(value => (value === undefined || value === zeroAddress ? null : value))
const addressFile = z.object({
  chainId: z.number().optional(),
  agentId: address,
  core: address.refine(value => value !== zeroAddress),
  court: optionalModule,
  vault: optionalModule,
})

// Explicit references let Next.js inline the values that next.config.ts reads from shared/abi.
export const defaultSources = (): AddressSources => ({
  local: process.env.NEXT_PUBLIC_ADDRESSES_LOCAL,
  bsc: process.env.NEXT_PUBLIC_ADDRESSES_BSC,
})

const missing: Record<SupportedChainId, string> = {
  31337: 'No contract addresses for chain 31337. Run "pnpm chain" and restart the dev server.',
  56: 'No contract addresses for chain 56. Add shared/abi/addresses.bsc.json after the Core release and rebuild.',
}

export function addresses(chainId: SupportedChainId, sources: AddressSources = defaultSources()): ContractAddresses {
  if (chainId !== 56 && chainId !== 31337) throw new RangeError(`Chain ${chainId} is not supported.`)
  const raw = chainId === 56 ? sources.bsc : sources.local
  if (!raw) throw new Error(missing[chainId])
  const invalid = new Error(`Invalid contract address file for chain ${chainId}.`)
  let parsed: z.output<typeof addressFile>
  try {
    parsed = addressFile.parse(JSON.parse(raw))
  } catch {
    throw invalid
  }
  if (parsed.chainId !== undefined && parsed.chainId !== chainId) throw invalid
  return { agentId: parsed.agentId, core: parsed.core, court: parsed.court, vault: parsed.vault }
}
