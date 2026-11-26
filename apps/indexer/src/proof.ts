import { hexToString, type Hex } from 'viem'

/**
 * The short proof is bytes on chain and text in the answer.
 *
 * The application writes the proof as text, so the indexer reads the bytes back as text and
 * keeps the text in the row. A proof that is not text stays as it is, so nothing is lost.
 */
export function proofText(proof: string): string {
  if (!proof.startsWith('0x')) return proof
  try {
    return hexToString(proof as Hex)
  } catch {
    return proof
  }
}
