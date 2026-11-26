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
  return { verdict, flags: scanFlags, quotes }
}

/** Adds a flag the Guardian reports. */
export function addFlag(choice: Choice, flag: FlagName): Choice {
  return {
    ...choice,
    flags: choice.flags | FLAGS[flag],
    quotes: { ...choice.quotes, [flag]: choice.quotes[flag] ?? '' },
  }
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
 * inside the mask of its target type. Every flag needs proof before the vote may be written.
 */
export function canReview(choice: Choice, proved: number, targetType: TargetType): boolean {
  if (choice.verdict === null) return false
  if (!isValidFlags(targetType, choice.verdict, choice.flags)) return false
  return missingQuotes(choice, proved).length === 0
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
  const names = (Object.keys(FLAGS) as FlagName[]).filter(name => (flags & FLAGS[name]) !== 0)
  return names.map(name => {
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
  const lines = Object.entries(quotes)
    .filter(([flag, quote]) => quote.trim() !== '' && (flags & (FLAGS[flag as FlagName] ?? 0)) !== 0)
    .map(([flag, quote]) => `${flag}: ${quote.trim()}`)
  if (lines.length === 0) return undefined
  return lines.join('\n').slice(0, STATEMENT_MAX_CHARS)
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
