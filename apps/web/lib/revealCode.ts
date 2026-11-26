import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { expectedChainId } from './chain/config'

/**
 * The reveal code of a juror: `sf1.<challengeId>.<u|r>.<salt hex 64>`.
 *
 * It holds the salt and the direction of the vote, so it is the only way to reveal the vote and
 * it must never be logged or put in a URL. The salt is 32 random bytes made in the browser and is
 * never derived from a signature: a signature can differ from one request to the next and can be
 * asked for by another site to open the vote.
 */
const PATTERN = /^sf1\.(0|[1-9][0-9]*)\.(u|r)\.([0-9a-fA-F]{64})$/
const UINT256_MAX = 2n ** 256n - 1n

export type RevealCode = { challengeId: bigint; uphold: boolean; salt: Hex }

/** The inputs of `Court.commitHashOf`, taken from the frozen ABI so the hash has one definition. */
const COMMIT_HASH_INPUTS = (() => {
  const entry = courtAbi.find(item => item.type === 'function' && item.name === 'commitHashOf')
  if (entry === undefined || entry.type !== 'function') throw new Error('The Court ABI has no commitHashOf.')
  return entry.inputs
})()

const toHex = (bytes: Uint8Array): string => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

/** A fresh code for one vote on one challenge. */
export function newRevealCode(challengeId: bigint, uphold: boolean): string {
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  // A browser that hands back zeroes has no randomness, and a salt of zeroes hides nothing.
  if (salt.every(byte => byte === 0)) throw new Error('The browser could not make a random salt.')
  return `sf1.${challengeId.toString()}.${uphold ? 'u' : 'r'}.${toHex(salt)}`
}

/** The parts of a code, or null when the text is not exactly a code. */
export function parseRevealCode(code: string): RevealCode | null {
  const match = PATTERN.exec(code.trim())
  if (match === null) return null
  const challengeId = BigInt(match[1] as string)
  if (challengeId > UINT256_MAX) return null
  return { challengeId, uphold: match[2] === 'u', salt: `0x${(match[3] as string).toLowerCase()}` }
}

/** The commit hash of a code for one juror: the same value `Court.commitHashOf` returns. */
export function commitHashFor(code: string, juror: Address): Hex {
  const parsed = parseRevealCode(code)
  if (parsed === null) throw new RangeError('That is not a reveal code.')
  return keccak256(encodeAbiParameters(COMMIT_HASH_INPUTS, [parsed.challengeId, juror, parsed.uphold, parsed.salt]))
}

/** One entry per chain, juror and challenge, so a code is never offered to another juror. */
const keyOf = (challengeId: bigint, juror: Address): string =>
  `sealflare:reveal:${expectedChainId}:${juror.toLowerCase()}:${challengeId.toString()}`

/** Keeps the code on this device. False when the browser refuses or the text is not a code. */
export function saveRevealCode(code: string, juror: Address): boolean {
  const parsed = parseRevealCode(code)
  if (parsed === null) return false
  try {
    localStorage.setItem(keyOf(parsed.challengeId, juror), code.trim())
    return true
  } catch {
    return false
  }
}

/** The code kept on this device for this challenge and juror, or null. */
export function loadRevealCode(challengeId: bigint, juror: Address): string | null {
  try {
    const stored = localStorage.getItem(keyOf(challengeId, juror))
    if (stored === null) return null
    // A value that names another challenge was not saved by this code, so it is not handed back.
    return parseRevealCode(stored)?.challengeId === challengeId ? stored : null
  } catch {
    return null
  }
}
