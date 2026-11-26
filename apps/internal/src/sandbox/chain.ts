import { bsc, bscTestnet, foundry } from 'viem/chains'
import { createPublicClient, fallback, http, recoverTypedDataAddress, type Address, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { API_EIP712 } from '@sealflare/shared/schemas'

/**
 * The chain the internal service reads.
 *
 * The internal service never writes to the chain and never signs a transaction. It reads two
 * things: whether an address holds an Agent ID, and who signed a request. The second one is pure
 * arithmetic on the signature, so it needs the chain id and nothing else.
 */
export interface ChainDeps {
  rpcUrls: string[]
  chainId: number
  coreAddress: Address
}

/** The signed message of a sandbox run. */
export interface SignedRun {
  bundleHash: Hex
  nonce: string
  expiry: string
  signature: Hex
}

export interface ChainReader {
  /** Whether the address holds an Agent ID, which every signed request needs. */
  isAgentIdHolder(address: Address): Promise<boolean>
  /** The address that signed the request, or null when the signature cannot be read. */
  recoverSigner(run: SignedRun): Promise<Address | null>
}

function chainFor(chainId: number) {
  if (chainId === bsc.id) return bsc
  if (chainId === bscTestnet.id) return bscTestnet
  if (chainId === foundry.id) return foundry
  throw new RangeError(`Chain ${chainId} is not supported.`)
}

/**
 * The EIP-712 domain of the API. The chain id is part of it, so a signature made for another
 * chain never recovers here.
 */
export function apiDomain(chainId: number) {
  return { name: API_EIP712.domain.name, version: API_EIP712.domain.version, chainId }
}

/**
 * The reader of the chain.
 *
 * A signature that cannot be recovered gives null and never an address: an unreadable signature
 * is not a signature.
 */
export function createChainReader(deps: ChainDeps): ChainReader {
  const urls = deps.rpcUrls.length > 0 ? deps.rpcUrls : ['http://127.0.0.1:8545']
  const client = createPublicClient({ chain: chainFor(deps.chainId), transport: fallback(urls.map(url => http(url))) })

  return {
    async isAgentIdHolder(address: Address): Promise<boolean> {
      return client.readContract({
        address: deps.coreAddress,
        abi: coreAbi,
        functionName: 'isAgentIdHolder',
        args: [address],
      })
    },

    async recoverSigner(run: SignedRun): Promise<Address | null> {
      try {
        return await recoverTypedDataAddress({
          domain: apiDomain(deps.chainId),
          types: { SandboxRun: API_EIP712.types.SandboxRun },
          primaryType: 'SandboxRun',
          message: { bundleHash: run.bundleHash, nonce: BigInt(run.nonce), expiry: BigInt(run.expiry) },
          signature: run.signature,
        })
      } catch {
        return null
      }
    },
  }
}
