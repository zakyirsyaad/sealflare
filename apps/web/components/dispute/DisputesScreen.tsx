'use client'
import type { ChallengeSummary } from '@sealflare/shared/schemas'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Table, type TableRow } from '../ui/Table'
import { modulesLive } from '../../lib/chain/config'
import { copy } from '../../lib/copy'
import { targetLabel } from '../../lib/format'
import { phaseWord, windowLeft } from './labels'
import { useNow } from './useNow'

export type DisputesScreenProps = {
  items: readonly ChallengeSummary[]
  failed: boolean
}

const COLUMNS = [
  { key: 'challenge', label: copy.dispute.colChallenge },
  { key: 'target', label: copy.dispute.colTargetName },
  { key: 'phase', label: copy.dispute.colPhase },
  { key: 'time', label: copy.dispute.colTime },
  { key: 'jury', label: copy.dispute.colJury },
] as const

function rowOf(item: ChallengeSummary, now: Date): TableRow {
  return {
    id: item.id,
    cells: {
      challenge: (
        <a className="sf-mono" href={`/app/disputes/${item.id}`}>
          #{item.id}
        </a>
      ),
      target: <span className="sf-mono">{targetLabel(item.label)}</span>,
      phase: phaseWord(item.phase, item.outcome),
      // The countdown is counted again in the browser, so its text may differ from the server's.
      time: <span suppressHydrationWarning>{windowLeft(item.phase, item, now) ?? copy.target.none}</span>,
      jury: copy.dispute.juryCount.replace('{commits}', String(item.commits)).replace('{reveals}', String(item.reveals)),
    },
  }
}

/**
 * The list of disputes.
 *
 * The phase of a row is the one the index read, and the time left counts down to the window that
 * is running. A list that could not be read is an error, never an empty list.
 */
export function DisputesScreen({ items, failed }: DisputesScreenProps) {
  const now = useNow()
  if (!modulesLive) return <EmptyState title={copy.common.modulesNotLive} />
  if (failed) {
    return <ErrorState what={copy.dispute.listFailed} onChainSafe onRetry={() => window.location.reload()} />
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={copy.dispute.listEmpty}
        action={
          <a className="sf-btn sf-btn--secondary" href="/app/explore">
            {copy.dispute.listEmptyAction}
          </a>
        }
      />
    )
  }
  return (
    <section className="sf-stack">
      <h1 className="sf-identity__label">{copy.dispute.listTitle}</h1>
      <div className="sf-frame sf-scroll">
        <Table caption={copy.dispute.listTitle} columns={COLUMNS} rows={items.map(item => rowOf(item, now))} />
      </div>
    </section>
  )
}
