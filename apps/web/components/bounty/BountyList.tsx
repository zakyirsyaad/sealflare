import Link from 'next/link'
import type { BountySummary } from '@sealflare/shared/schemas'
import { EmptyState } from '../ui/EmptyState'
import { Table } from '../ui/Table'
import { copy } from '../../lib/copy'
import { formatBnb, formatDate } from '../../lib/format'

export type BountyListProps = {
  items: readonly BountySummary[]
  /** Whether the vault and the court are live. A bounty cannot be funded before they are. */
  live: boolean
}

const columns = [
  { key: 'target', label: copy.bounty.targetLabel },
  { key: 'slots', label: copy.bounty.colSlots },
  { key: 'amount', label: copy.bounty.colAmount },
  { key: 'created', label: copy.bounty.created },
]

/**
 * Whether a bounty can still be filled.
 *
 * The screen of the bounties shows the open ones, the ones that still have a slot left, because
 * a bounty that is full or settled cannot be filled any more.
 */
function isOpen(bounty: BountySummary): boolean {
  return !bounty.settled && bounty.filled < bounty.slots
}

/**
 * The list of the bounties, the open ones first.
 *
 * A row opens the target the bounty is about, because a bounty is filled by attesting that
 * target. While the modules are not live the list is empty, and it says why.
 */
export function BountyList({ items, live }: BountyListProps) {
  if (!live) return <EmptyState title={copy.common.modulesNotLive} />
  const open = items.filter(isOpen)
  if (open.length === 0) {
    return (
      <EmptyState
        title={copy.bounty.empty}
        action={
          <Link className="sf-btn sf-btn--secondary" href="/app">
            {copy.bounty.emptyAction}
          </Link>
        }
      />
    )
  }
  const rows = open.map(item => ({
    id: item.id,
    cells: {
      target: <Link href={`/app/t/${item.targetId}`}>{item.label}</Link>,
      slots: copy.bounty.filled.replace('{filled}', String(item.filled)).replace('{slots}', String(item.slots)),
      amount: copy.bounty.amount.replace('{amount}', formatBnb(item.amount)),
      created: formatDate(item.createdAt),
    },
  }))
  return (
    <div className="sf-frame sf-scroll">
      <Table caption={copy.bounty.title} columns={columns} rows={rows} />
    </div>
  )
}
