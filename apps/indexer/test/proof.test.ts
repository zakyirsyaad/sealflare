import { expect, test } from 'vitest'
import { CONSTANTS } from '@sealflare/shared/rules'
import { proofText } from '../src/proof'

/**
 * The short proof is bytes on chain and text in the answer.
 *
 * The proof is written by any Agent ID holder and the contract only checks its length, so the
 * bytes can be anything. The row they end up in has to hold them and the answer has to be able
 * to carry them.
 */

test('a proof that is text is kept as the text it is', () => {
  expect(proofText('0x554e4558')).toBe('UNEX')
  expect(proofText('UNEX')).toBe('UNEX')
})

test('a NUL byte becomes the replacement character, so Postgres takes the row', () => {
  const proof = proofText('0x550045')
  expect(proof).toBe('U\uFFFDE')
  expect(proof).not.toContain('\u0000')
})

test('bytes that are not text keep the hex they came in', () => {
  // A lone continuation byte is not a character, so there is no text to read.
  expect(proofText('0xff')).toBe('0xff')
  expect(proofText('0x41ff42')).toBe('0x41ff42')
})

test('a proof that is not text is cut to the length the answer allows', () => {
  const bytes = `0x${'ff'.repeat(CONSTANTS.SHORT_PROOF_MAX_BYTES)}`
  const proof = proofText(bytes)
  expect(new TextEncoder().encode(proof).length).toBeLessThanOrEqual(CONSTANTS.SHORT_PROOF_MAX_BYTES)
})

test('a proof of text that fits is never cut', () => {
  const text = 'a'.repeat(CONSTANTS.SHORT_PROOF_MAX_BYTES)
  expect(proofText(`0x${Buffer.from(text).toString('hex')}`)).toBe(text)
})
