import { CONSTANTS } from '@sealflare/shared/rules'
import type { ChallengePhase } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { windowLeft } from './labels'

export type PhaseStripProps = {
  /** The phase the Court names. Null while the chain has not answered. */
  phase: ChallengePhase | null
  commitEndsAt: string
  revealEndsAt: string
  now: Date
}

type Cell = { key: 'COMMIT' | 'REVEAL' | 'AWAITING_CLOSE'; number: string; name: string; help: string }

const CELLS: readonly Cell[] = [
  { key: 'COMMIT', number: '01', name: copy.dispute.phaseCommit, help: copy.dispute.commitHelp },
  { key: 'REVEAL', number: '02', name: copy.dispute.phaseReveal, help: copy.dispute.revealHelp },
  {
    key: 'AWAITING_CLOSE',
    number: '03',
    name: copy.dispute.phaseResolve,
    help: copy.dispute.resolveHelp.replace('{min}', String(CONSTANTS.MIN_REVEALS)),
  },
]

/** What the big line of a phase says: the time left of a window, or the state of the closing step. */
function statusOf(cell: Cell, props: PhaseStripProps): string | null {
  if (props.phase === 'CLOSED') return cell.key === 'AWAITING_CLOSE' ? copy.dispute.phaseClosed : null
  if (cell.key === 'AWAITING_CLOSE') {
    return props.phase === 'AWAITING_CLOSE'
      ? copy.dispute.phaseReady
      : copy.dispute.needsReveals.replace('{min}', String(CONSTANTS.MIN_REVEALS))
  }
  return props.phase === cell.key ? windowLeft(props.phase, props, props.now) : null
}

/**
 * The three phases of a dispute, with the time left of the one that is running.
 *
 * The phase is the one the Court names. The clock of the browser only counts the time left down,
 * so a browser with a wrong clock can show a wrong countdown but never a wrong phase.
 */
export function PhaseStrip(props: PhaseStripProps) {
  return (
    <ol className="sf-frame sf-phases" aria-label={copy.dispute.phasesLabel}>
      {CELLS.map(cell => {
        const active = props.phase === cell.key
        const status = statusOf(cell, props)
        return (
          <li key={cell.key} className="sf-phase" aria-current={active ? 'step' : undefined} data-active={active}>
            <span className="sf-mono sf-phase__name">
              <span aria-hidden="true">{cell.number} </span>
              <span>{cell.name}</span>
            </span>
            {status !== null && <span className="sf-phase__status sf-mono" suppressHydrationWarning>
                {status}
              </span>}
            <span className="sf-phase__help">{cell.help}</span>
          </li>
        )
      })}
    </ol>
  )
}
