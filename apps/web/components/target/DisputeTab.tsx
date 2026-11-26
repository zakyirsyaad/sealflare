'use client'
import type { ChallengeSummary } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { phaseWord, windowLeft } from '../dispute/labels'
import { useNow } from '../dispute/useNow'

export type DisputeTabProps = {
  /** The disputes of this target, or null when they could not be read. */
  challenges: readonly ChallengeSummary[] | null
  /** The id of the open challenge on the target, as the registry names it. */
  activeChallengeId: string | null
}

function OpenLink({ id }: { id: string }) {
  return <a href={`/app/disputes/${id}`}>{copy.dispute.viewOpen}</a>
}

/** The disputes of one target: the open one with its time left, and the history. */
export function DisputeTab({ challenges, activeChallengeId }: DisputeTabProps) {
  const now = useNow()
  if (challenges === null) {
    return (
      <div className="sf-tab__facts">
        <p className="sf-tab__empty">{copy.dispute.listFailed}</p>
        {activeChallengeId !== null && <OpenLink id={activeChallengeId} />}
      </div>
    )
  }
  if (challenges.length === 0) {
    // The index can lag the registry, so an open challenge is still named when the list is empty.
    if (activeChallengeId !== null) return <OpenLink id={activeChallengeId} />
    return <p className="sf-tab__empty">{copy.target.noDisputes}</p>
  }
  return (
    <table className="sf-table">
      <caption className="sf-sr-only">{copy.dispute.tabHistory}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.dispute.colChallenge}</th>
          <th scope="col">{copy.dispute.colPhase}</th>
          <th scope="col">{copy.dispute.colTime}</th>
        </tr>
      </thead>
      <tbody>
        {challenges.map(item => (
          <tr key={item.id}>
            <td data-label={copy.dispute.colChallenge}>
              <a className="sf-mono" href={`/app/disputes/${item.id}`}>
                #{item.id}
              </a>
            </td>
            <td data-label={copy.dispute.colPhase}>{phaseWord(item.phase, item.outcome)}</td>
            <td data-label={copy.dispute.colTime}>
              <span suppressHydrationWarning>{windowLeft(item.phase, item, now) ?? copy.target.none}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
