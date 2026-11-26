'use client'
import type { ActivityItem } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { targetLabel } from '../../lib/format'
import { Table, type TableRow } from '../ui/Table'

export type HistoryProps = {
  items: readonly ActivityItem[]
}

const COLUMNS = [
  { key: 'what', label: copy.activity.colWhat },
  { key: 'target', label: copy.activity.colTarget },
  { key: 'result', label: copy.activity.colResult },
  { key: 'reputation', label: copy.activity.colReputation },
] as const

/** What a kind of activity is called in the history. */
function kindLabel(kind: ActivityItem['kind']): string {
  if (kind === 'attestation') return copy.activity.kindAttestation
  if (kind === 'juror') return copy.activity.kindJuror
  if (kind === 'challenge') return copy.activity.kindChallenge
  if (kind === 'bounty') return copy.activity.kindBounty
  return copy.activity.kindBond
}

/**
 * The reputation an event earned.
 *
 * An event that earns no reputation yet says so, instead of showing a zero that reads like a
 * lost point.
 */
function xpLabel(xp: number | null): string {
  if (xp === null) return copy.activity.pending
  return xp > 0 ? `+${xp}` : String(xp)
}

/** One row of the history. */
function rowOf(item: ActivityItem, index: number): TableRow {
  return {
    id: `${item.kind}:${item.targetId}:${item.at}:${index}`,
    cells: {
      what: kindLabel(item.kind),
      target: <span className="sf-mono">{targetLabel(item.label)}</span>,
      result: item.result,
      reputation: <span className="sf-mono">{xpLabel(item.xp)}</span>,
    },
  }
}

/**
 * What the account did: its votes, its seats in a jury, its disputes, its bounties and its bonds.
 *
 * The newest event comes first, and an event that earns no reputation says so instead of showing
 * a zero.
 */
export function History({ items }: HistoryProps) {
  return (
    <section className="sf-frame" aria-label={copy.activity.history}>
      <div className="sf-panel__head"><h2>{copy.activity.history}</h2></div>
      <div className="sf-scroll">
        <Table caption={copy.activity.history} columns={COLUMNS} rows={newestFirst(items).map(rowOf)} />
      </div>
    </section>
  )
}

/** The events of the account, the newest one first. */
function newestFirst(items: readonly ActivityItem[]): ActivityItem[] {
  return [...items].sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
}
