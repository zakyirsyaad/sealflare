import Link from 'next/link'
import type { BountySummary } from '@sealflare/shared/schemas'
import { EmptyState } from '../ui/EmptyState'
import { Table } from '../ui/Table'
import { copy } from '../../lib/copy'
import { formatBnb, formatDate } from '../../lib/format'

export type BountyListProps = {
  items: readonly BountySummary[]
  /** How many open bounties the indexer knows, so the pager knows how many pages there are. */
  total: number
  /** The page this list holds. */
  page: number
  /** How many rows a page holds. */
  limit: number
}

const columns = [
  { key: 'target', label: copy.bounty.targetLabel },
  { key: 'slots', label: copy.bounty.colSlots },
  { key: 'amount', label: copy.bounty.colAmount },
  { key: 'created', label: copy.bounty.created },
]

/**
 * The pages of the list.
 *
 * The last page never offers a next one, and a page before the first never offers a previous
 * one, so the reader never walks into a page that does not exist.
 */
function Pager({ page, total, limit }: { page: number; total: number; limit: number }) {
  const pages = Math.max(1, Math.ceil(total / limit))
  if (pages <= 1) return null
  return (
    <nav className="sf-pager" aria-label={copy.bounty.pagerLabel}>
      {page > 1 ? (
        <Link className="sf-btn sf-btn--secondary" href={`/app/bounties?page=${page - 1}`}>
          {copy.bounty.previousPage}
        </Link>
      ) : (
        <span />
      )}
      <span className="sf-pager__where">
        {copy.bounty.pageOf.replace('{page}', String(page)).replace('{pages}', String(pages))}
      </span>
      {page < pages ? (
        <Link className="sf-btn sf-btn--secondary" href={`/app/bounties?page=${page + 1}`}>
          {copy.bounty.nextPage}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

/**
 * The list of the bounties that can still be filled.
 *
 * The rows come from the indexer, and its query already keeps only the bounties that still have
 * a slot left, so the rows and the total of the list always agree. A row opens the target the
 * bounty is about, because a bounty is filled by attesting that target.
 */
export function BountyList({ items, total, page, limit }: BountyListProps) {
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
      created: formatDate(item.createdAt),
    },
  }))
  return (
    <div className="sf-stack">
      <div className="sf-frame sf-scroll">
        <Table caption={copy.bounty.title} columns={columns} rows={rows} />
      </div>
      <Pager page={page} total={total} limit={limit} />
    </div>
  )
}
