import { getAddress, zeroAddress, type Address } from 'viem'
import { z } from 'zod'
import { expectedChainId } from './config'

export type SupportedChainId = 56 | 97 | 31337
export type ContractAddresses = { agentId: Address; core: Address; court: Address | null; vault: Address | null }
export type AddressSources = { local?: string; bsc?: string; bscTestnet?: string }

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
  bscTestnet: process.env.NEXT_PUBLIC_ADDRESSES_BSC_TESTNET,
})

const missing: Record<SupportedChainId, string> = {
  31337: 'No contract addresses for chain 31337. Run "pnpm chain" and restart the dev server.',
  56: 'No contract addresses for chain 56. Add shared/abi/addresses.bsc.json after the Core release and rebuild.',
  97: 'No contract addresses for chain 97. Add shared/abi/addresses.bsc-testnet.json after the testnet deploy and rebuild.',
}

const sourceKey: Record<SupportedChainId, keyof AddressSources> = { 31337: 'local', 56: 'bsc', 97: 'bscTestnet' }

export function addresses(chainId: SupportedChainId, sources: AddressSources = defaultSources()): ContractAddresses {
  if (!Object.hasOwn(sourceKey, chainId)) throw new RangeError(`Chain ${chainId} is not supported.`)
  const raw = sources[sourceKey[chainId]]
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

/** The address of the registry, or null when the deployment names none. */
export function coreAddress(): Address | null {
  try {
    return addresses(expectedChainId).core
  } catch {
    return null
  }
}

/** The address of the vault, or null when the deployment names none. */
export function vaultAddress(): Address | null {
  try {
    return addresses(expectedChainId).vault
  } catch {
    return null
  }
}
