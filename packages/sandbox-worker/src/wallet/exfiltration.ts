import { Buffer } from 'node:buffer'
import type { ToolCall } from './tools'

const MIN_FRAGMENT = 8

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

/** Match returned data only, including common wire encodings and slices of at least eight characters. */
export function leaksRead(call: ToolCall, reads: Set<string>): boolean {
  let body = ''
  try { body = typeof call.args.body === 'string' ? call.args.body : JSON.stringify(call.args.body) ?? '' }
  catch { /* Malformed HTTP input is rejected by respondTo, not treated as returned data. */ }
  const text = `${typeof call.args.url === 'string' ? call.args.url : ''}\n${body}`
  const plain = [text, decodedHttpText(text)], decoded = decodedPayloads(plain)
  return [...reads].some((value) => {
    const variants = [...new Set([value, value.toWellFormed(), JSON.stringify(value).slice(1, -1)])]
    if (variants.some((variant) => plain.some((candidate) => candidate.includes(variant)))) return true
    if (value.length < MIN_FRAGMENT) return false
    const fragments = new Set(variants.flatMap((variant) => Array.from(
      { length: Math.max(0, variant.length - MIN_FRAGMENT + 1) }, (_, offset) => variant.slice(offset, offset + MIN_FRAGMENT))))
    return [...plain, ...decoded].some((candidate) => containsFragment(candidate, fragments))
  })
}
