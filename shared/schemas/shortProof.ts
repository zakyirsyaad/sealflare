import { CONSTANTS, FLAG_NAMES, type FlagName } from '../rules'
import { utf8Length } from './primitives'

export type ShortProofItem = { flag: FlagName; location: string; excerpt: string }

const LINE_PATTERN = /^([A-Z0-9_]+) @ ([^\n]*?): ([^\n]*)$/
const KNOWN_FLAGS: ReadonlySet<string> = new Set(FLAG_NAMES)

/** One line per item, so a line break inside a field must not survive. */
const oneLine = (text: string): string => text.replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' ')
/** A colon followed by whitespace ends the location when parsing, so a location may not contain one. */
const cleanLocation = (text: string): string => oneLine(text).replace(/:\s+/g, ':')

/** Longest prefix of `text` that fits `maxBytes` of UTF-8 without splitting a code point. */
function truncateUtf8(text: string, maxBytes: number): string {
  let used = 0
  let out = ''
  for (const char of text) {
    const size = utf8Length(char)
    if (used + size > maxBytes) break
    used += size
    out += char
  }
  return out
}

const render = (items: readonly ShortProofItem[]): string =>
  items.map((item) => `${item.flag} @ ${item.location}: ${item.excerpt}`).join('\n')

/** Largest cap in [0, max] for which `fits(cap)` holds, assuming fits is monotonic. Returns -1 if none. */
function largestFittingCap(max: number, fits: (cap: number) => boolean): number {
  if (!fits(0)) return -1
  let low = 0
  let high = max
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * Evidence summary written on-chain: `FLAG_NAME @ location: excerpt`, one line per item, at most
 * 512 bytes of UTF-8. When it does not fit, the longest excerpts are shortened first, then the
 * longest locations. The flag names are never cut.
 */
export function buildShortProof(items: readonly ShortProofItem[]): string {
  const limit = CONSTANTS.SHORT_PROOF_MAX_BYTES
  const clean = items.map((item) => ({ flag: item.flag, location: cleanLocation(item.location), excerpt: oneLine(item.excerpt) }))
  const capped = (excerptCap: number, locationCap: number): ShortProofItem[] =>
    clean.map((item) => ({
      flag: item.flag,
      location: truncateUtf8(item.location, locationCap),
      excerpt: truncateUtf8(item.excerpt, excerptCap),
    }))
  const fits = (candidate: ShortProofItem[]) => utf8Length(render(candidate)) <= limit

  const excerptCap = largestFittingCap(limit, (cap) => fits(capped(cap, limit)))
  if (excerptCap >= 0) return render(capped(excerptCap, limit))

  const locationCap = largestFittingCap(limit, (cap) => fits(capped(0, cap)))
  if (locationCap < 0) throw new RangeError('Too many items to fit a short proof.')
  return render(capped(0, locationCap))
}

/** Reads a short proof back. Lines that are not items, or name an unknown flag, are skipped. */
export function parseShortProof(text: string): ShortProofItem[] {
  return text.split('\n').flatMap((line) => {
    const match = LINE_PATTERN.exec(line)
    if (!match) return []
    const [, flag = '', location = '', excerpt = ''] = match
    return KNOWN_FLAGS.has(flag) ? [{ flag: flag as FlagName, location, excerpt }] : []
  })
}
