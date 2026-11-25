import type { Address, Hex, PublicClient } from 'viem'

export const CORE = '0x1111111111111111111111111111111111111111' as Address
export const TARGET = '0x3333333333333333333333333333333333333333' as Address
export const IMPLEMENTATION = '0x4444444444444444444444444444444444444444' as Address
export const PUBLISHER = '0x5555555555555555555555555555555555555555' as Address
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
export const ZERO_WORD = `0x${'0'.repeat(64)}` as Hex

/** The EIP-1967 implementation slot, the same slot the scanner reads. */
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex

/** A storage word that holds an address in its last twenty bytes. */
export const wordOf = (address: Address): Hex => `0x${'0'.repeat(24)}${address.slice(2)}` as Hex

export type FakeState = {
  tier?: number
  flags?: number
  pinnedCodehash?: Hex
  firewallTier?: number
  firewallProxy?: boolean
  firewallFlags?: number
  /** The bond of the verified publisher, as the firewall reports it. */
  firewallBond?: bigint
  skillTier?: number
  /** The verified publisher of the bundle, as the firewall reports it. */
  skillPublisher?: Address
  skillFlags?: number
  skillBond?: bigint
  code?: Hex
  /** The node answers that the account has no code, the way viem does for an empty account. */
  noCode?: boolean
  /** The node answers nothing for a storage read, which is not an empty slot. */
  noStorage?: boolean
  codeByAddress?: Record<string, Hex>
  storage?: Record<string, Hex>
  /** The votes of the target, in the order the registry keeps them. */
  attestations?: { verdict: number; flags?: number; weight: number }[]
  /** The name of the one call that fails, so a test can prove that failures throw. */
  fail?: string
}

export type FakeChain = {
  client: PublicClient
  calls: string[]
  reads: { functionName: string; args?: readonly unknown[] }[]
}

/** A chain that answers from memory. It never reaches the network. */
export function fakeChain(state: FakeState = {}): FakeChain {
  const calls: string[] = []
  const reads: { functionName: string; args?: readonly unknown[] }[] = []
  const refuse = (name: string): never => {
    throw new Error(`The node did not answer the call to ${name}.`)
  }
  const client = {
    async readContract({ address, functionName, args }: {
      address: Address
      abi: readonly unknown[]
      functionName: string
      args?: readonly unknown[]
    }): Promise<unknown> {
      calls.push(`${functionName}@${address}`)
      reads.push({ functionName, args })
      if (state.fail === functionName) return refuse(functionName)
      if (functionName === 'tierOf') return state.tier ?? 0
      if (functionName === 'getTarget') {
        return {
          pinnedCodehash: state.pinnedCodehash ?? ZERO_WORD,
          activeFlags: state.flags ?? 0,
          attestationCount: state.attestations?.length ?? 0,
        }
      }
      if (functionName === 'getAttestation') {
        const index = Number(args?.[1] ?? 0)
        const attestation = state.attestations?.[index]
        if (!attestation) throw new Error(`No attestation at index ${index}.`)
        return { verdict: attestation.verdict, flags: attestation.flags ?? 0, weight: attestation.weight }
      }
      if (functionName === 'verifyContract') {
        return [
          state.firewallTier ?? state.tier ?? 0,
          state.firewallProxy ?? false,
          state.pinnedCodehash ?? ZERO_WORD,
          state.firewallFlags ?? state.flags ?? 0,
          state.firewallBond ?? 0n,
        ]
      }
      if (functionName === 'verifySkillBundle') {
        return [
          state.skillTier ?? state.tier ?? 0,
          state.skillPublisher ?? ZERO_ADDRESS,
          state.skillFlags ?? state.flags ?? 0,
          state.skillBond ?? state.firewallBond ?? 0n,
        ]
      }
      throw new Error(`Unexpected read: ${functionName}`)
    },
    async getCode({ address }: { address: Address }): Promise<Hex | undefined> {
      calls.push(`getCode@${address}`)
      if (state.fail === 'getCode') return refuse('getCode')
      if (state.noCode) return undefined
      return state.codeByAddress?.[address] ?? state.code ?? '0x'
    },
    async getStorageAt({ address, slot }: { address: Address; slot: Hex }): Promise<Hex | undefined> {
      calls.push(`getStorageAt@${address}`)
      if (state.fail === 'getStorageAt') return refuse('getStorageAt')
      if (state.noStorage) return undefined
      return state.storage?.[slot] ?? ZERO_WORD
    },
    async call({ to }: { to: Address; data: Hex }): Promise<{ data: Hex | undefined }> {
      calls.push(`call@${to}`)
      if (state.fail === 'call') return refuse('call')
      return { data: '0x' as Hex }
    },
    async getBlockNumber(): Promise<bigint> {
      return 1n
    },
  }
  return { client: client as unknown as PublicClient, calls, reads }
}
