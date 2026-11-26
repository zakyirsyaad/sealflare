import { hexToBytes, type Hex } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'
import { withoutNul } from './decode'

/**
 * The short proof is bytes on chain and text in the answer.
 *
 * The application writes the proof as text, so the indexer reads the bytes back as text. Bytes
 * that are not valid UTF-8 keep the hex they came in: a lossy decode would change the proof and
 * could make it longer than the answer allows.
 *
 * A NUL byte becomes U+FFFD, the same way the other calldata strings are cleaned. Postgres refuses
 * U+0000 in a text column, so one odd proof would roll back the range for good and the indexer
 * would read that range forever.
 *
 * The result never holds more bytes than the answer allows, so a proof that is not text is cut
 * instead of breaking the answer of the target it belongs to.
 */
export function proofText(proof: string): string {
  const text = proof.startsWith('0x') ? decodeHex(proof) : proof
  return cutToBytes(withoutNul(text), CONSTANTS.SHORT_PROOF_MAX_BYTES)
}

/**
 * The text of a hex proof, or the hex itself when the bytes are not text.
 *
 * The decode is strict: a byte that is not part of a character means the proof is not text, and
 * the hex keeps every byte of it.
 */
function decodeHex(proof: string): string {
  let bytes: Uint8Array
  try {
    bytes = hexToBytes(proof as Hex)
  } catch {
    return proof
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return proof
  }
}

/** The text, cut to a number of bytes without cutting a character in half. */
function cutToBytes(text: string, max: number): string {
  const encoder = new TextEncoder()
  let bytes = 0
  let out = ''
  for (const character of text) {
    const size = encoder.encode(character).length
    if (bytes + size > max) break
    bytes += size
    out += character
  }
  return out
}
