const EXCERPT_MAX = 160

// ignoreBOM keeps a leading U+FEFF in the text so downstream checks see every character.
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Decodes strict UTF-8. Returns null when the bytes are not valid UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch {
    return null
  }
}

const clampIndex = (text: string, index: number): number => Math.max(0, Math.min(index, text.length))

function lineAt(text: string, index: number): { number: number; start: number; end: number } {
  let number = 1
  let start = 0
  for (const separator of text.matchAll(/\r\n|[\r\n]/g)) {
    const nextStart = separator.index + separator[0].length
    if (index < nextStart) return { number, start, end: separator.index }
    number += 1
    start = nextStart
  }
  return { number, start, end: text.length }
}

/** 1-based line number of the character at index. A newline belongs to the line it ends. */
export function lineOf(text: string, index: number): number {
  return lineAt(text, clampIndex(text, index)).number
}

/**
 * The single line containing index, at most 160 characters, without line breaks.
 * Short lines are returned whole; long lines yield a window centered on the match.
 */
export function excerptAt(text: string, index: number, length: number): string {
  const at = clampIndex(text, index)
  const { start, end } = lineAt(text, at)
  const line = text.slice(start, end)
  if (line.length <= EXCERPT_MAX) return line
  const matchAt = Math.min(at, end) - start
  const matchLen = Math.max(0, Math.min(length, EXCERPT_MAX))
  const ideal = matchAt - Math.floor((EXCERPT_MAX - matchLen) / 2)
  const windowStart = Math.max(0, Math.min(ideal, line.length - EXCERPT_MAX))
  return line.slice(windowStart, windowStart + EXCERPT_MAX)
}
