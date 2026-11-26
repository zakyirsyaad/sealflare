'use client'
import { useRef } from 'react'
import { CONSTANTS, XP } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { utcOf } from './schedule'

export type VoteStepProps = {
  /** The `JurorStatus` the Court names for this wallet. Null until the Court answers. */
  status: number | null
  noCourt: boolean
  /** The vote that was chosen: true to uphold, false to reject, null before the juror chooses. */
  vote: boolean | null
  onVote: (uphold: boolean) => void
  onContinue: () => void
}

const OPTIONS = [
  { uphold: true, title: copy.jury.uphold, help: copy.jury.upholdHelp },
  { uphold: false, title: copy.jury.reject, help: copy.jury.rejectHelp },
] as const

/** The two votes, as a group of radio buttons that the arrow keys move through. */
function VoteOptions({ vote, onVote }: Pick<VoteStepProps, 'vote' | 'onVote'>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const move = (index: number, key: string) => {
    const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return false
    const next = (index + step + OPTIONS.length) % OPTIONS.length
    onVote((OPTIONS[next] as (typeof OPTIONS)[number]).uphold)
    buttons.current[next]?.focus()
    return true
  }
  return (
    <section role="radiogroup" aria-label={copy.jury.voteTitle} className="sf-stack">
      {OPTIONS.map((option, index) => (
        <button
          key={option.title}
          ref={element => {
            buttons.current[index] = element
          }}
          type="button"
          role="radio"
          aria-checked={vote === option.uphold}
          tabIndex={vote === option.uphold || (vote === null && index === 0) ? 0 : -1}
          className="sf-opt"
          onClick={() => onVote(option.uphold)}
          onKeyDown={event => {
            if (move(index, event.key)) event.preventDefault()
          }}
        >
          <span aria-hidden="true" className="sf-opt__marker" />
          <span>
            <span className="sf-opt__title">{option.title}</span>
            <span className="sf-opt__help">{option.help}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

/**
 * The first step: whether the Court lets this wallet join, and the vote.
 *
 * A wallet that may not join is told why in a sentence of its own and is offered nothing else.
 * Nothing is chosen for the juror.
 */
export function VoteStep({ status, noCourt, vote, onVote, onContinue }: VoteStepProps) {
  if (noCourt) return <p className="sf-lead">{copy.dispute.noCourt}</p>
  if (status === null) return <p className="sf-lead">{copy.jury.checking}</p>
  if (status !== 0) return <p className="sf-lead">{copy.jurorStatus[status] ?? copy.jury.statusUnknown}</p>
  return (
    <>
      <section className="sf-stack">
        <p className="sf-lead">{copy.jurorStatus[0]}</p>
        <p className="sf-lead">{copy.jury.voteHelp}</p>
      </section>
      <VoteOptions vote={vote} onVote={onVote} />
      <footer className="sf-panel__footer">
        <Button variant="primary" disabled={vote === null} onClick={onContinue}>
          {copy.jury.continue}
        </Button>
      </footer>
    </>
  )
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className="sf-rows__row">
      <span className="sf-rows__name">{name}</span>
      <span className="sf-rows__value">{value}</span>
    </div>
  )
}

export type SummaryStepProps = {
  commitEndsAt: string
  revealEndsAt: string
  onBack: () => void
  onContinue: () => void
}

/** The second step: the stake, when to come back, and the two ways the stake is lost. */
export function SummaryStep({ commitEndsAt, revealEndsAt, onBack, onContinue }: SummaryStepProps) {
  return (
    <>
      <section className="sf-stack">
        <div className="sf-rows">
          <Row name={copy.jury.rowStake} value={copy.jury.stakeValue.replace('{amount}', formatBnb(CONSTANTS.JURY_STAKE))} />
          <Row
            name={copy.jury.rowSchedule}
            value={copy.jury.scheduleValue.replace('{from}', utcOf(commitEndsAt)).replace('{to}', utcOf(revealEndsAt))}
          />
        </div>
      </section>
      <section className="sf-stack">
        <span className="sf-mono">{copy.jury.loseTitle}</span>
        <ul className="sf-endings">
          <li>{copy.jury.loseNoReveal}</li>
          <li>{copy.jury.loseMinority}</li>
        </ul>
        <p className="sf-lead">{copy.jury.winNote.replace('{xp}', String(XP.JUROR_MAJORITY))}</p>
      </section>
      <footer className="sf-panel__footer">
        <Button variant="primary" onClick={onContinue}>
          {copy.jury.continue}
        </Button>
        <Button onClick={onBack}>{copy.attest.back}</Button>
      </footer>
    </>
  )
}
