import { bsc, bscTestnet, foundry } from 'wagmi/chains'

// The chains the app knows about, in one place so the config and the UI names cannot drift.
export const chains = [bsc, bscTestnet, foundry] as const

const names: Record<number, string> = { 56: 'BNB Smart Chain', 97: 'BNB Smart Chain testnet', 31337: 'local Anvil chain' }

export function chainName(chainId: number): string {
  return names[chainId] ?? `Chain ${chainId}`
}
