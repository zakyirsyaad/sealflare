import { createPublicClient, http, type Address, type PublicClient } from 'viem'
import { bsc, bscTestnet } from 'viem/chains'
import { createGuard, type Guard } from '@sealflare/guard'

/** The chain the skill reads. The mainnet of BNB Chain is the default. */
export function chainOf(chainId: number) {
  if (chainId === 97) return bscTestnet
  if (chainId !== 56) throw new Error(`The chain ${chainId} is not supported. Use 56 or 97.`)
  return bsc
}

/** A public client. The skill only reads; it never signs and never sends anything. */
export function publicClient(rpc: string, chainId: number): PublicClient {
  return createPublicClient({ chain: chainOf(chainId), transport: http(rpc) }) as PublicClient
}

/** The guard reads the registry through the client. Every answer comes from the Core contract. */
export function guardFor(client: PublicClient, core: Address): Guard {
  return createGuard({ client, core })
}
