import type { Hex } from 'viem'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/

/**
 * The word of a contract target.
 *
 * `Core.attest` takes the word, not the id: the address in the last twenty bytes of a bytes32,
 * with the twelve bytes before it zero. The id is the hash of that word, so it is never the word.
 */
export function contractWord(address: string): Hex | null {
  if (!ADDRESS_PATTERN.test(address)) return null
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}` as Hex
}

/** Whether a bytes32 can be the word of a contract target. */
export function isContractWord(word: string): boolean {
  return BYTES32_PATTERN.test(word) && word.slice(2, 26) === '0'.repeat(24)
}

/** Whether a string is a bytes32 at all. */
export function isBytes32(word: string): boolean {
  return BYTES32_PATTERN.test(word)
}
