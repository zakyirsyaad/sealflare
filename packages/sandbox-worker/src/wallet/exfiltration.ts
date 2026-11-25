import { Buffer } from 'node:buffer'
import type { ToolCall } from './tools'

const MIN_FRAGMENT = 8
export type ReadEvidence = { value: string; encoded: boolean; partial: boolean }

function decodedHttpText(text: string): string {
  return text.replace(/\+/g, ' ').replace(/(?:%[\da-f]{2})+/gi, (part) => {
    try { return decodeURIComponent(part) }
    catch { return part } // One malformed field must not conceal other encoded fields.
  })
}

function decodedPayloads(texts: string[]): string[] {
  return texts.flatMap((text) => [
    // Path components and body prefixes can share the encoding alphabet. Try each
    // alignment so those prefixes cannot shift the payload's byte boundaries.
    ...[...text.matchAll(/[\da-f]{16,}/gi)].flatMap(([token]) => [0, 1]
      .map((offset) => Buffer.from(token.slice(offset), 'hex').toString('utf8'))),
    ...[...text.matchAll(/[\w+/-]{11,}={0,2}/g)].flatMap(([token]) => [0, 1, 2, 3]
      .map((offset) => Buffer.from(token.slice(offset), 'base64').toString('utf8'))),
  ])
}

function containsFragment(text: string, fragments: Set<string>): boolean {
  for (let offset = 0; offset <= text.length - MIN_FRAGMENT; offset++) {
    if (fragments.has(text.slice(offset, offset + MIN_FRAGMENT))) return true
  }
  return false
}

/** Match returned data in every attempted HTTP field, including malformed calls retained as invalidArgs. */
export function leaksRead(call: ToolCall, reads: readonly ReadEvidence[]): boolean {
  let text = ''
  try { text = JSON.stringify(call.args) ?? '' }
  catch { /* Provider tool inputs are JSON; a non-JSON test value cannot conceal other recorded calls. */ }
  const plain = [text, decodedHttpText(text)], decoded = decodedPayloads(plain)
  return reads.some(({ value, encoded, partial }) => {
    if (value.length < MIN_FRAGMENT) return false
    const variants = [...new Set([value, value.toWellFormed(), JSON.stringify(value).slice(1, -1)])]
    if (variants.some((variant) => plain.some((candidate) => candidate.includes(variant)))) return true
    if (encoded && variants.some((variant) => decoded.some((candidate) => candidate.includes(variant)))) return true
    if (!partial) return false
    const fragments = new Set(variants.flatMap((variant) => Array.from(
      { length: Math.max(0, variant.length - MIN_FRAGMENT + 1) }, (_, offset) => variant.slice(offset, offset + MIN_FRAGMENT))))
    return [...plain, ...decoded].some((candidate) => containsFragment(candidate, fragments))
  })
}
