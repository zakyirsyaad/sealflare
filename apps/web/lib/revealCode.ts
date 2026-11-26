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

/** How many attempts are kept for one juror in one challenge. */
const MAX_KEPT = 50

/** The codes kept under a key, oldest first. Anything that is not a code of this challenge is left out. */
function readList(challengeId: bigint, juror: Address): string[] {
  const stored = readStored(challengeId, juror)
  if (stored === null) return []
  return asCodes(stored).filter(code => parseRevealCode(code)?.challengeId === challengeId)
}

/** The text under the key, or null when the browser keeps nothing or refuses to answer. */
function readStored(challengeId: bigint, juror: Address): string | null {
  try {
    return localStorage.getItem(keyOf(challengeId, juror))
  } catch {
    return null
  }
}

/**
 * The stored text as a list of codes.
 *
 * A browser that ran an earlier build of this page kept a bare code under the key, so a text that is
 * not a list is read as a list of one. That code is a stake that must not be lost.
 */
function asCodes(stored: string): string[] {
  try {
    const list: unknown = JSON.parse(stored)
    if (Array.isArray(list)) return list.filter((item): item is string => typeof item === 'string')
  } catch {
    // The text is not a list, so it can still be a bare code of an earlier build.
  }
  return parseRevealCode(stored) === null ? [] : [stored.trim()]
}

/**
 * Keeps the code on this device. False when the browser refuses or the text is not a code.
 *
 * A code is added to the ones already kept and never replaces one. A juror who goes through the
 * commit twice, because the first transaction was still pending, would otherwise lose the code
 * that matches the commit on the chain, and a lost code is a lost stake.
 */
export function saveRevealCode(code: string, juror: Address): boolean {
  const parsed = parseRevealCode(code)
  if (parsed === null) return false
  const kept = readList(parsed.challengeId, juror)
  const text = code.trim()
  const list = kept.includes(text) ? kept : [...kept, text].slice(-MAX_KEPT)
  try {
    localStorage.setItem(keyOf(parsed.challengeId, juror), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** Every code kept on this device for this challenge and juror, oldest first. */
export function loadRevealCodes(challengeId: bigint, juror: Address): string[] {
  return readList(challengeId, juror)
}

/**
 * The code kept on this device for this challenge and juror, or null.
 *
 * With the commit hash the Court holds, it is the code that hashes to it, whichever attempt it
 * came from. Without one it is the newest.
 */
export function loadRevealCode(challengeId: bigint, juror: Address, commitHash?: Hex): string | null {
  const kept = readList(challengeId, juror)
  if (commitHash === undefined) return kept.at(-1) ?? null
  return kept.find(code => commitHashFor(code, juror).toLowerCase() === commitHash.toLowerCase()) ?? null
}

/** Whether this browser keeps things on this device. A private window may not. Leaves nothing behind. */
export function canKeepRevealCode(): boolean {
  const probe = 'sealflare:probe'
  try {
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
