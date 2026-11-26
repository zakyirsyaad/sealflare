import { decodeAbiParameters, type Address, type Hex } from 'viem'

/** The only function the Publish flow reads from an untrusted target. */
export const ownerAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/**
 * The owner a target reports, or null when it has none. The contracts accept only an answer of
 * exactly one word whose upper 12 bytes are zero, so longer data or a dirty upper part has no
 * owner here either, and the deployer path stays open for that target.
 */
export function decodeOwner(data: unknown): Address | null {
  if (typeof data !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(data)) return null
  try {
    const [owner] = decodeAbiParameters([{ type: 'address' }], data as Hex)
    return owner === '0x0000000000000000000000000000000000000000' ? null : owner
  } catch {
    return null
  }
}
