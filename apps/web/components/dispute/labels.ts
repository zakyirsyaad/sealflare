import { CONSTANTS } from '@sealflare/shared/rules'
import type { ChallengeSummary } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { targetLabel, timeLeft } from '../../lib/format'

type Outcome = ChallengeSummary['outcome']
type Phase = ChallengeSummary['phase'] | 'NONE'

const OUTCOME_WORD: Record<Outcome, string> = {
  PENDING: copy.dispute.outcomePending,
  UPHELD: copy.dispute.outcomeUpheld,
  REJECTED: copy.dispute.outcomeRejected,
  TIED: copy.dispute.outcomeTied,
  EXPIRED: copy.dispute.outcomeExpired,
}

const VERDICT_TEXT: Record<Outcome, string> = {
  PENDING: '',
  UPHELD: copy.dispute.verdictUpheld,
  REJECTED: copy.dispute.verdictRejected,
  TIED: copy.dispute.verdictTied,
  EXPIRED: copy.dispute.verdictExpired.replace('{min}', String(CONSTANTS.MIN_REVEALS)),
}

export const outcomeWord = (outcome: Outcome): string => OUTCOME_WORD[outcome]

/** One sentence that says what a closed dispute decided. */
export const verdictText = (outcome: Outcome): string => VERDICT_TEXT[outcome]

/** The phase in a word. A closed dispute is named by how it ended. */
export function phaseWord(phase: Phase, outcome: Outcome): string {
  if (phase === 'COMMIT') return copy.dispute.phaseCommit
  if (phase === 'REVEAL') return copy.dispute.phaseReveal
  if (phase === 'AWAITING_CLOSE') return copy.dispute.phaseReady
  if (phase === 'CLOSED') return outcome === 'PENDING' ? copy.dispute.phaseClosed : outcomeWord(outcome)
  return copy.dispute.phaseClosed
}

/** The time left of the window that is running, or null when none is. */
export function windowLeft(
  phase: Phase,
  window: { commitEndsAt: string; revealEndsAt: string },
  now: Date,
): string | null {
  if (phase === 'COMMIT') return copy.dispute.timeLeft.replace('{time}', timeLeft(new Date(window.commitEndsAt), now))
  if (phase === 'REVEAL') return copy.dispute.timeLeft.replace('{time}', timeLeft(new Date(window.revealEndsAt), now))
  return null
}
