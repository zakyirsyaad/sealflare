import Link from 'next/link'
import type { BountySummary } from '@sealflare/shared/schemas'
import { EmptyState } from '../ui/EmptyState'
import { Table } from '../ui/Table'
import { copy } from '../../lib/copy'
import { formatBnb, formatUtc } from '../../lib/format'

export type BountyListProps = {
  items: readonly BountySummary[]
  /** Whether the vault and the court are live. A bounty cannot be funded before they are. */
  live: boolean
}

const columns = [
  { key: 'target', label: copy.bounty.targetLabel },
  { key: 'slots', label: copy.bounty.slotsLabel },
  { key: 'amount', label: copy.bounty.amountLabel },
  { key: 'created', label: copy.bounty.created },
]

/**
 * The list of the bounties, the open ones first.
 *
 * A row opens the target the bounty is about, because a bounty is filled by attesting that
 * target. While the modules are not live the list is empty, and it says why.
 */
export function BountyList({ items, live }: BountyListProps) {
  if (!live) return <EmptyState title={copy.common.modulesNotLive} />
  if (items.length === 0) {
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
  const rows = items.map(item => ({
    id: item.id,
    cells: {
      target: <Link href={`/app/t/${item.targetId}`}>{item.label}</Link>,
      slots: copy.bounty.filled.replace('{filled}', String(item.filled)).replace('{slots}', String(item.slots)),
      amount: copy.bounty.amount.replace('{amount}', formatBnb(item.amount)),
      created: formatUtc(new Date(item.createdAt).getTime() / 1000),
    },
  }))
  return <Table caption={copy.bounty.title} columns={columns} rows={rows} />
}
