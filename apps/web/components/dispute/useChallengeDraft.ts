'use client'
import { useState } from 'react'
import { FLAGS, type FlagName } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'
import {
  addFlag,
  chooseVerdict,
  missingQuotes,
  provedFlags,
  removeFlag,
  setQuote,
  shortProofOf,
  travellingScan,
  type Choice,
} from '../attest/choice'

/**
 * What the challenger has filled in so far, and what follows from it.
 *
 * The flags of the scan are ticked from the start. A quote is needed for every flag whose excerpt
 * does not travel with the report, and the summary written on-chain is only previewed once every
 * flag has one.
 */
export function useChallengeDraft(scan: ScanReport | null, targetId: string) {
  const [choice, setChoice] = useState<Choice>(() => chooseVerdict('DANGER', scan?.flags ?? 0))
  const [statement, setStatement] = useState('')
  const proved = provedFlags(choice, scan, targetId)
  const complete = missingQuotes(choice, proved).length === 0
  return {
    choice,
    statement,
    proved,
    complete,
    preview: complete ? shortProofOf(choice.flags, choice.quotes, travellingScan(choice, scan, targetId)) : '',
    canContinue: complete && statement.trim() !== '',
    setStatement,
    toggle: (flag: FlagName) =>
      setChoice(current => ((current.flags & FLAGS[flag]) === 0 ? addFlag(current, flag) : removeFlag(current, flag))),
    quote: (flag: FlagName, text: string) => setChoice(current => setQuote(current, flag, text)),
  }
}
