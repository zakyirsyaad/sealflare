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
 * least one flag, which the Guardian adds when the scanner found nothing.
 */
export function chooseVerdict(verdict: Verdict, scanFlags: number): Choice {
  if (verdict === 'SAFE') return { verdict, flags: 0, quotes: {} }
  return { verdict, flags: scanFlags, quotes: {} }
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

/** The flags the scanner did not find and that still wait for a quote. */
export function missingQuotes(choice: Choice, scanFlags: number): FlagName[] {
  return flagsOf(choice).filter(
    name => (scanFlags & FLAGS[name]) === 0 && (choice.quotes[name] ?? '').trim().length === 0,
  )
}

/** A Safe vote needs no flag. Caution and Danger need at least one, and every flag needs proof. */
export function canReview(choice: Choice, scanFlags: number): boolean {
  if (choice.verdict === null) return false
  if (choice.verdict !== 'SAFE' && choice.flags === 0) return false
  return missingQuotes(choice, scanFlags).length === 0
}

/**
 * The evidence summary written on-chain.
 *
 * A flag the scanner found keeps the place and the line the scanner read. A flag the Guardian
 * added carries the quote the Guardian wrote.
 */
export function shortProofOf(choice: Choice, scan: ScanReport | null): string {
  const items: ShortProofItem[] = flagsOf(choice).map(name => {
    const finding = scan?.findings.find(item => item.flag === name)
    const excerpt = finding?.excerpt ?? (choice.quotes[name] ?? '').trim()
    return { flag: name, location: finding?.location ?? 'user report', excerpt }
  })
  return items.length === 0 ? '' : buildShortProof(items)
}
