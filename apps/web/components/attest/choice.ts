import { CONSTANTS, FLAGS, flagNames, isValidFlags, type FlagName, type TargetType, type Verdict } from '@sealflare/shared/rules'
import { STATEMENT_MAX_CHARS, buildShortProof, utf8Length, type ScanReport, type ShortProofItem } from '@sealflare/shared/schemas'

/** What the Guardian chose so far. */
export type Choice = {
  verdict: Verdict | null
  /** The flags that are reported, as a bit mask. */
  flags: number
  /** The quote the Guardian wrote for a flag the scanner did not find. */
  quotes: Record<string, string>
}

export const emptyChoice: Choice = { verdict: null, flags: 0, quotes: {} }

/**
 * Choosing a verdict takes the flags of the scanner with it.
 *
 * A Safe vote carries no flags at all, so choosing it clears them. Caution and Danger need at
 * least one flag, which the Guardian adds when the scanner found nothing. The quotes the
 * Guardian wrote stay, so a wrong choice can be corrected without writing them again.
 */
export function chooseVerdict(verdict: Verdict, scanFlags: number, quotes: Record<string, string> = {}): Choice {
  if (verdict === 'SAFE') return { verdict, flags: 0, quotes }
  // The quotes are kept as they are. A verdict may add a flag, and the room every quote has gets
  // smaller with it, but a quote the Guardian wrote is never cut without saying so.
  return { verdict, flags: scanFlags, quotes }
}

/**
 * How many characters each quote may hold, so the statement of the report always fits.
 *
 * The statement holds one line `FLAG: quote` for every flag, joined by line breaks, and the report
 * refuses a statement above `STATEMENT_MAX_CHARS`. The inputs are capped to this length, so a long
 * quote is stopped while it is written. Every flag takes a part of the room, so a quote written
 * before another flag was added may be longer than the room that is left, and then the vote waits
 * until the Guardian shortens it.
 */
export function quoteLimit(flags: number): number {
  const names = flagNames(flags)
  if (names.length === 0) return STATEMENT_MAX_CHARS
  const overhead = names.reduce((sum, name) => sum + name.length + 2, 0) + names.length - 1
  return Math.floor((STATEMENT_MAX_CHARS - overhead) / names.length)
}

/** The lines of the statement, one for every flag that carries a quote. */
export function statementLines(flags: number, quotes: Record<string, string>): string[] {
  return Object.entries(quotes)
    .filter(([flag, quote]) => quote.trim() !== '' && (flags & (FLAGS[flag as FlagName] ?? 0)) !== 0)
    .map(([flag, quote]) => `${flag}: ${quote.trim()}`)
}

/**
 * Whether the statement of the report fits.
 *
 * Adding a flag leaves every quote less room. The quotes are never cut to make room, so the
 * statement can be too long, and then the vote is blocked until the Guardian shortens a quote.
 */
export function statementFits(flags: number, quotes: Record<string, string>): boolean {
  return statementLines(flags, quotes).join('\n').length <= STATEMENT_MAX_CHARS
}

/** Adds a flag the Guardian reports. */
export function addFlag(choice: Choice, flag: FlagName): Choice {
  const flags = choice.flags | FLAGS[flag]
  // The quotes the Guardian wrote stay as they are. The room they have gets smaller, and the
  // statement is then too long until a quote is shortened, which the Guardian is told about.
  return { ...choice, flags, quotes: { ...choice.quotes, [flag]: choice.quotes[flag] ?? '' } }
}

/** Takes a flag back out of the report. */
export function removeFlag(choice: Choice, flag: FlagName): Choice {
  const quotes = { ...choice.quotes }
  delete quotes[flag]
  return { ...choice, flags: choice.flags & ~FLAGS[flag], quotes }
}

/** The quote of a flag, as the Guardian wrote it. */
export function setQuote(choice: Choice, flag: FlagName, quote: string): Choice {
  return { ...choice, quotes: { ...choice.quotes, [flag]: quote } }
}

/** The flags of the choice, in the order of the flag list. */
export function flagsOf(choice: Choice): FlagName[] {
  return flagNames(choice.flags)
}

/**
 * The scan that travels with the report.
 *
 * A report may only carry a scan of its own target, and only when it still holds every flag the
 * scan found. Otherwise the scan stays out, and no excerpt of it may be written on-chain.
 */
export function travellingScan(
  choice: Choice,
  scan: ScanReport | null,
  targetId: string,
): ScanReport | null {
  if (scan === null) return null
  if (scan.targetId !== targetId) return null
  if ((choice.flags & scan.flags) !== scan.flags) return null
  return scan
}

/** The excerpt the scanner read for a flag. An empty excerpt proves nothing. */
function excerptOf(scan: ScanReport | null, flag: FlagName): string {
  const finding = scan?.findings.find(item => item.flag === flag)
  return (finding?.excerpt ?? '').trim()
}

/**
 * The flags whose excerpt travels with the report.
 *
 * Without the scan no excerpt travels, so every flag the Guardian reports has to carry a quote
 * the Guardian wrote. A finding without an excerpt proves nothing either, so it needs a quote too.
 */
export function provedFlags(choice: Choice, scan: ScanReport | null, targetId: string): number {
  const travelling = travellingScan(choice, scan, targetId)
  if (travelling === null) return 0
  return flagsOf(choice).reduce(
    (bits, name) => (excerptOf(travelling, name) === '' ? bits : bits | FLAGS[name]),
    0,
  )
}

/** The flags that still wait for a quote from the Guardian. */
export function missingQuotes(choice: Choice, proved: number): FlagName[] {
  return flagsOf(choice).filter(
    name => (proved & FLAGS[name]) === 0 && (choice.quotes[name] ?? '').trim().length === 0,
  )
}

/**
 * Whether the summary may be shown.
 *
 * A Safe vote carries no flag, Caution and Danger carry at least one, and every flag stays
 * inside the mask of its target type. Every flag needs proof before the vote may be written, and
 * the statement of the report has to fit, so no quote is ever cut to make room.
 */
export function canReview(choice: Choice, proved: number, targetType: TargetType): boolean {
  if (choice.verdict === null) return false
  if (!isValidFlags(targetType, choice.verdict, choice.flags)) return false
  if (missingQuotes(choice, proved).length > 0) return false
  return statementFits(choice.flags, choice.quotes)
}

/** The longest prefix of `text` that fits `maxBytes` of UTF-8. */
function cut(text: string, maxBytes: number): string {
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

/** The lines of the proof, with the place each quote was read. */
function proofItems(flags: number, quotes: Record<string, string>, scan: ScanReport | null): ShortProofItem[] {
  return flagNames(flags).map(name => {
    const finding = scan?.findings.find(item => item.flag === name)
    const excerpt = excerptOf(scan, name)
    if (excerpt !== '') return { flag: name, location: finding?.location ?? 'user report', excerpt }
    return { flag: name, location: 'user report', excerpt: (quotes[name] ?? '').trim() }
  })
}

/**
 * The evidence summary written on-chain.
 *
 * A flag the scanner found keeps the place and the line the scanner read. A flag the Guardian
 * added carries the quote the Guardian wrote. Only the scan that is attached to the report may
 * be quoted, so every line on-chain comes from the document that was uploaded.
 */
export function shortProofOf(
  flags: number,
  quotes: Record<string, string>,
  scan: ScanReport | null,
): string {
  const items = proofItems(flags, quotes, scan)
  return items.length === 0 ? '' : buildProof(items)
}

/**
 * The proof with every line keeping at least one character of quote.
 *
 * `buildShortProof` shortens the excerpts when they do not fit, and it may shorten them to
 * nothing. The excerpts are shortened here first, so no line on-chain is ever empty.
 */
function buildProof(items: ShortProofItem[]): string {
  for (const locationCap of [200, 60, 40, 20, 0]) {
    const trimmed = items.map(item => ({ ...item, location: cut(item.location, locationCap) }))
    const overhead =
      trimmed.reduce((sum, item) => sum + utf8Length(`${item.flag} @ ${item.location}: `), 0) +
      trimmed.length -
      1
    const budget = Math.floor((CONSTANTS.SHORT_PROOF_MAX_BYTES - overhead) / trimmed.length)
    if (budget < 1) continue
    return buildShortProof(trimmed.map(item => ({ ...item, excerpt: cut(item.excerpt, budget) })))
  }
  return buildShortProof(items)
}

/**
 * The full quotes of the Guardian for the flags that are reported, one line each.
 *
 * The short proof on-chain cuts long quotes to fit 512 bytes, so the report keeps the whole text.
 * Undefined when the Guardian wrote no quote.
 */
export function statementOf(flags: number, quotes: Record<string, string>): string | undefined {
  const lines = statementLines(flags, quotes)
  if (lines.length === 0) return undefined
  // The statement is never cut. It is either whole or it is not written, and the vote is blocked
  // before it is signed when it is too long.
  return lines.join('\n')
}

/**
 * The scan with one finding per flag. The flags of the scan stay the same, so it is still a valid
 * report, and the short proof reads the first finding of a flag, so it does not change either.
 */
export function trimScan(scan: ScanReport): ScanReport {
  const seen = new Set<string>()
  const findings = scan.findings.filter(finding => {
    if (seen.has(finding.flag)) return false
    seen.add(finding.flag)
    return true
  })
  return { ...scan, findings }
}
