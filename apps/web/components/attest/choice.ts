import { FLAGS, type FlagName, type Verdict } from '@sealflare/shared/rules'
import { buildShortProof, type ScanReport, type ShortProofItem } from '@sealflare/shared/schemas'

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
  return (Object.keys(FLAGS) as FlagName[]).filter(name => (choice.flags & FLAGS[name]) !== 0)
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

/**
 * The flags whose excerpt travels with the report.
 *
 * Without the scan no excerpt travels, so every flag the Guardian reports has to carry a quote
 * the Guardian wrote. The other way, an excerpt on-chain is never empty.
 */
export function provedFlags(choice: Choice, scan: ScanReport | null, targetId: string): number {
  return travellingScan(choice, scan, targetId)?.flags ?? 0
}

/** The flags that still wait for a quote from the Guardian. */
export function missingQuotes(choice: Choice, proved: number): FlagName[] {
  return flagsOf(choice).filter(
    name => (proved & FLAGS[name]) === 0 && (choice.quotes[name] ?? '').trim().length === 0,
  )
}

/** A Safe vote needs no flag. Caution and Danger need at least one, and every flag needs proof. */
export function canReview(choice: Choice, proved: number): boolean {
  if (choice.verdict === null) return false
  if (choice.verdict !== 'SAFE' && choice.flags === 0) return false
  return missingQuotes(choice, proved).length === 0
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
  const names = (Object.keys(FLAGS) as FlagName[]).filter(name => (flags & FLAGS[name]) !== 0)
  const items: ShortProofItem[] = names.map(name => {
    const finding = scan?.findings.find(item => item.flag === name)
    const excerpt = finding?.excerpt ?? (quotes[name] ?? '').trim()
    return { flag: name, location: finding?.location ?? 'user report', excerpt }
  })
  return items.length === 0 ? '' : buildShortProof(items)
}
