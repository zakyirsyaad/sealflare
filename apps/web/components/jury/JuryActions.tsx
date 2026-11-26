'use client'
import { useState } from 'react'
import { Button } from '../ui/Button'
import type { ChallengePhase } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { JoinPanel } from './JoinPanel'
import { RevealPanel } from './RevealPanel'
import { utcOf } from './schedule'
import { useJuror } from './useJuror'

export type JuryActionsProps = {
  challengeId: string
  /** The phase the Court names. Nothing is offered until it is known. */
  phase: ChallengePhase | null
  commitEndsAt: string
  revealEndsAt: string
}

/**
 * What a juror can do in the jury box: join while jurors commit, reveal while they reveal.
 *
 * Joining is offered in the commit phase and revealing only in the reveal phase, to a juror who
 * committed and has not revealed. A vote that stays hidden is never shown here.
 */
export function JuryActions({ challengeId, phase, commitEndsAt, revealEndsAt }: JuryActionsProps) {
  const [panel, setPanel] = useState<'join' | 'reveal' | null>(null)
  const { juror, account, refetch } = useJuror(challengeId)
  const close = () => {
    setPanel(null)
    void refetch()
  }
  if (phase === null) return null
  const committed = juror?.committed === true
  const revealed = juror?.revealed === true
  return (
    <div className="sf-stack">
      {phase === 'COMMIT' && !committed && <Button variant="primary" onClick={() => setPanel('join')}>{copy.jury.join}</Button>}
      {phase === 'COMMIT' && committed && (
        <p className="sf-lead">{copy.jury.committedNote.replace('{time}', utcOf(commitEndsAt))}</p>
      )}
      {/* Without a wallet nothing is known about the juror, so the way in is offered and the panel asks to connect. */}
      {phase === 'REVEAL' && ((committed && !revealed) || account === null) && (
        <Button variant="primary" onClick={() => setPanel('reveal')}>
          {copy.jury.reveal}
        </Button>
      )}
      {phase === 'REVEAL' && revealed && (
        <p className="sf-lead">{copy.jury.yourVote.replace('{vote}', juror?.uphold === true ? copy.jury.uphold : copy.jury.reject)}</p>
      )}
      {(phase === 'AWAITING_CLOSE' || phase === 'CLOSED') && committed && !revealed && (
        <p className="sf-lead">{copy.jury.revealOver}</p>
      )}
      {panel === 'join' && (
        <JoinPanel challengeId={challengeId} commitEndsAt={commitEndsAt} revealEndsAt={revealEndsAt} onClose={close} />
      )}
      {panel === 'reveal' && (
        <RevealPanel challengeId={challengeId} phase={phase} commitEndsAt={commitEndsAt} onClose={close} />
      )}
    </div>
  )
}
