import type { Address, Hex } from 'viem'
import { copy } from '../../lib/copy'
import { commitHashFor, parseRevealCode, type RevealCode } from '../../lib/revealCode'

export type RevealCheck = { ok: true; code: RevealCode } | { ok: false; message: string }

/**
 * Checks a reveal code against the commit hash the Court holds, before anything is sent.
 *
 * A reveal that does not match reverts, and a revealed vote cannot be taken back, so every code is
 * refused here when it is malformed, belongs to another dispute, or does not hash to the commit of
 * this juror. That covers a flipped direction and a code that another juror committed with.
 */
export function checkRevealCode(text: string, challengeId: bigint, juror: Address, onChainHash: Hex): RevealCheck {
  const code = parseRevealCode(text)
  if (code === null) return { ok: false, message: copy.jury.codeMalformed }
  if (code.challengeId !== challengeId) return { ok: false, message: copy.jury.codeOtherChallenge }
  if (commitHashFor(text, juror).toLowerCase() !== onChainHash.toLowerCase()) {
    return { ok: false, message: copy.errors.CommitMismatch }
  }
  return { ok: true, code }
}
