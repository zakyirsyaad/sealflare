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
 * The owner a target reports, or null when it has none. A target that answers with anything but a
 * clean address word has no owner that can be trusted, which is what the contracts do as well.
 */
export function decodeOwner(data: unknown): Address | null {
  if (typeof data !== 'string' || data === '0x') return null
  try {
    const [owner] = decodeAbiParameters([{ type: 'address' }], data as Hex)
    return owner === '0x0000000000000000000000000000000000000000' ? null : owner
  } catch {
    return null
  }
}
