'use client'
import type { Address } from 'viem'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'
import { ApplyPenaltiesButton } from './ApplyPenaltiesButton'

/** A target of the account on which a penalty is still waiting. */
export type PendingPenalty = { targetId: string; pending: number; attestations: number | null }

export type PenaltiesPanelProps = {
  account: Address
  /** The targets on which a penalty is still waiting. */
  penalties: readonly PendingPenalty[]
  /** The moment the numbers of the penalties were read from the chain. */
  updatedAt: number
  /** The numbers of the penalties could not be read. */
  failed: boolean
  /** The targets could not be read, so the range of a page is unknown. */
  viewsFailed: boolean
  /**
   * Called once a page of penalties was mined, with the number that was waiting before the page.
   *
   * The page of the screen measures the page against that number, so a page that clears its target
   * does not take the report of the page with it.
   */
  onApplied: (targetId: string, before: number) => void
  /** Called when the reader asks for the chain to answer again. */
  onRetry: () => void
}

/**
 * The panel of the penalties that wait on the targets of the account.
 *
 * The penalties are not one of the actions of ux.md section 11, so they have a panel of their own
 * and the count of the needs action panel stays the count of the mark on the wallet button.
 */
export function PenaltiesPanel({
  account,
  penalties,
  updatedAt,
  failed,
  viewsFailed,
  onApplied,
  onRetry,
}: PenaltiesPanelProps) {
  if (penalties.length === 0) return null
  return (
    <section className="sf-frame sf-frame--crop" aria-label={copy.activity.penaltiesPanel}>
      <div className="sf-panel__head sf-panel__head--row">
        <h2>{copy.activity.penaltiesPanel}</h2>
        <span className="sf-mono">{penalties.length}</span>
      </div>
      <ul className="sf-todos">
        {penalties.map(penalty => (
          <PenaltyRow
            key={penalty.targetId}
            penalty={penalty}
            account={account}
            updatedAt={updatedAt}
            failed={failed}
            viewsFailed={viewsFailed}
            onApplied={onApplied}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </section>
  )
}

/** A target of the account on which a penalty is still waiting. */
function PenaltyRow({
  penalty,
  account,
  updatedAt,
  failed,
  viewsFailed,
  onApplied,
  onRetry,
}: {
  penalty: PendingPenalty
  account: Address
  updatedAt: number
  failed: boolean
  viewsFailed: boolean
  onApplied: (targetId: string, before: number) => void
  onRetry: () => void
}) {
  return (
    <li className="sf-todo">
      <div className="sf-todo__body">
        <h3 className="sf-todo__title">{copy.activity.penaltiesTitle.replace('{target}', shortAddress(penalty.targetId))}</h3>
        <p className="sf-todo__detail">{copy.activity.penaltiesDetail}</p>
      </div>
      <ApplyPenaltiesButton
        account={account}
        targetId={penalty.targetId}
        pending={penalty.pending}
        attestations={penalty.attestations}
        updatedAt={updatedAt}
        failed={failed}
        viewsFailed={viewsFailed}
        onApplied={before => onApplied(penalty.targetId, before)}
        onRetry={onRetry}
      />
    </li>
  )
}
