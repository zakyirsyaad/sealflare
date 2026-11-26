'use client'
import type { Address } from 'viem'
import type { NeedsAction as NeedsActionItem } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { dueText, rowOf, sortByUrgency, type ActionRow } from '../../lib/activity/needsAction'
import { useNow } from '../../lib/activity/useNow'
import { SettleXpButton } from './SettleXpButton'

export type NeedsActionProps = {
  account: Address
  /** The actions the indexer found for the account. */
  items: readonly NeedsActionItem[]
  /** Called once a settlement was mined, so the rows of the account are read again. */
  onSettled?: () => void
}

/**
 * The panel of the things that wait on the account.
 *
 * The rows come from the indexed rows of the account, so an action never says something the chain
 * has not said yet. The order of the rows is the order of urgency: the action that is due first
 * comes first. The count of the panel is the count of the mark on the wallet button.
 */
export function NeedsAction({ account, items, onSettled }: NeedsActionProps) {
  const now = useNow()
  const rows = sortByUrgency(items).map(rowOf)
  if (rows.length === 0) return null
  return (
    <section className="sf-frame sf-frame--crop" aria-label={copy.activity.needsAction}>
      <div className="sf-panel__head sf-panel__head--row">
        <h2>{copy.activity.needsAction}</h2>
        <span className="sf-mono">{rows.length}</span>
      </div>
      <ul className="sf-todos">
        {rows.map((row, index) => (
          <Row key={row.key} row={row} account={account} now={now} primary={index === 0} onSettled={onSettled} />
        ))}
      </ul>
    </section>
  )
}

/** One action that waits on the account. */
function Row({
  row,
  account,
  now,
  primary,
  onSettled,
}: {
  row: ActionRow
  account: Address
  now: Date
  primary: boolean
  onSettled?: () => void
}) {
  const when = dueText(row.dueAt, now)
  return (
    <li className="sf-todo">
      <div className="sf-todo__body">
        <h3 className="sf-todo__title">{row.title}</h3>
        <p className="sf-todo__detail">{row.detail}</p>
      </div>
      {when !== null && <span className="sf-todo__when" suppressHydrationWarning>{when}</span>}
      <Control row={row} account={account} primary={primary} onSettled={onSettled} />
    </li>
  )
}

/** The control of a row: the page where the action happens, or the button that starts it. */
function Control({
  row,
  account,
  primary,
  onSettled,
}: {
  row: ActionRow
  account: Address
  primary: boolean
  onSettled?: () => void
}) {
  const variant = primary ? 'sf-btn--primary' : 'sf-btn--secondary'
  if (row.kind === 'claim') return <SettleXpButton account={account} targetId={row.targetId} primary={primary} onSettled={onSettled} />
  if (row.kind === 'reveal' || row.kind === 'reply' || row.kind === 'close') {
    // The dispute page of a challenge that has no number is a page that does not exist.
    if (row.challengeId === null) return <p className="sf-lead">{copy.activity.noChallenge}</p>
    return (
      <a className={`sf-btn ${variant}`} href={`/app/disputes/${row.challengeId}`}>
        {labelOf(row.kind)}
      </a>
    )
  }
  return (
    <a className={`sf-btn ${variant}`} href={`/app/t/${row.targetId}`}>
      {labelOf(row.kind)}
    </a>
  )
}

/** The word on the button of a row. */
function labelOf(kind: ActionRow['kind']): string {
  if (kind === 'reveal') return copy.activity.revealAction
  if (kind === 'reply') return copy.activity.replyAction
  if (kind === 'close') return copy.activity.closeAction
  if (kind === 'bond') return copy.activity.bondAction
  return copy.activity.bountyAction
}
