import type { AttestationRow } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { shortAddress, verdictLabel } from '../../lib/format'

export type HistoryTabProps = { rows: readonly AttestationRow[] }

/** The on-chain events of this target, oldest first. */
export function HistoryTab({ rows }: HistoryTabProps) {
  const events = [
    { at: null, title: copy.target.created, note: null as string | null },
    ...rows.map(row => ({ at: row.at, title: copy.target.historyVote.replace('{verdict}', verdictLabel(row.verdict)), note: shortAddress(row.guardian) })),
  ]
  return (
    <ul className="sf-history">
      {events.map((event, index) => (
        <li key={index} className="sf-history__event">
          <span className="sf-mono sf-history__when">{event.at === null ? '' : event.at.slice(0, 10)}</span>
          <span className="sf-history__title">{event.title}</span>
          {event.note !== null && <span className="sf-history__note">{event.note}</span>}
        </li>
      ))}
    </ul>
  )
}
