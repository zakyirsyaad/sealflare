import { CONSTANTS } from '@sealflare/shared/rules'
import type { ChallengeDetail } from '@sealflare/shared/schemas'
import type { ChallengePhase } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'

export type JuryBoxProps = {
  phase: ChallengePhase | null
  commits: number
  reveals: number
  /** What the viewer can do as a juror: join, or reveal. */
  children?: React.ReactNode
}

/**
 * The jury, as a count.
 *
 * While jurors are committing the box shows how many there are and nothing else. A direction of
 * a vote is never part of this box.
 */
export function JuryBox({ phase, commits, reveals, children }: JuryBoxProps) {
  const committing = phase === 'COMMIT'
  return (
    <aside className="sf-frame sf-jury" aria-label={copy.dispute.jury}>
      <div className="sf-rows__row sf-evidence__head">
        <span className="sf-mono">{copy.dispute.jury}</span>
        {committing && <span className="sf-mono">{copy.dispute.votesHidden}</span>}
      </div>
      <div className="sf-stack sf-evidence__body">
        <p className="sf-jury__count">{copy.dispute.committed.replace('{count}', String(commits))}</p>
        {!committing && <p className="sf-lead">{copy.dispute.revealed.replace('{count}', String(reveals))}</p>}
        <p className="sf-lead">{copy.dispute.needsReveals.replace('{min}', String(CONSTANTS.MIN_REVEALS))}</p>
        {children}
      </div>
    </aside>
  )
}

/** The jurors of a dispute with the direction of the votes that were revealed. Never shown while jurors commit. */
export function JurorsTable({ jurors }: { jurors: ChallengeDetail['jurors'] }) {
  if (jurors.length === 0) return null
  return (
    <table className="sf-table">
      <caption>{copy.dispute.jurors}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.dispute.juror}</th>
          <th scope="col">{copy.target.weight}</th>
          <th scope="col">{copy.dispute.vote}</th>
        </tr>
      </thead>
      <tbody>
        {jurors.map(juror => (
          <tr key={juror.address}>
            <td className="sf-mono" data-label={copy.dispute.juror}>
              {shortAddress(juror.address)}
            </td>
            <td className="sf-mono" data-label={copy.target.weight}>
              {juror.weight}
            </td>
            <td data-label={copy.dispute.vote}>{voteWord(juror)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function voteWord(juror: ChallengeDetail['jurors'][number]): string {
  if (!juror.revealed || juror.uphold === null) return copy.dispute.notRevealed
  return juror.uphold ? copy.jury.uphold : copy.jury.reject
}
