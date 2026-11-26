'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { GuardianSummary } from '@sealflare/shared/schemas'
import { loadGuardians } from '../../lib/api/lists'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'
import { PageLinks } from '../target/PageLinks'
import { TargetTable, type TableColumn, type TableRow } from '../target/TargetTable'
import { Chip } from '../ui/Chip'
import { ErrorState, EmptyState } from '../ui'
import { Skeleton } from '../ui/Skeleton'

/** How many Guardians one page of the list holds. */
export const PAGE_SIZE = 20

export type GuardiansListProps = {
  page: number
}

/** The columns of the Guardian list. */
const COLUMNS: readonly TableColumn[] = [
  { key: 'guardian', label: copy.guardians.columns.guardian },
  { key: 'score', label: copy.guardians.columns.score },
  { key: 'weight', label: copy.guardians.columns.weight },
  { key: 'attestations', label: copy.guardians.columns.attestations },
  { key: 'status', label: copy.guardians.columns.status },
]

/** The address of the list with a page in it. */
function hrefOf(page: number): string {
  return page > 1 ? `/app/guardians?page=${page}` : '/app/guardians'
}

/** One row of the list. */
function rowOf(item: GuardianSummary): TableRow {
  return {
    id: item.address,
    cells: {
      guardian: (
        <Link className="sf-mono sf-list__name" href={`/app/g/${item.address}`}>
          {shortAddress(item.address)}
        </Link>
      ),
      score: <span className="sf-mono">{item.score}</span>,
      weight: <span className="sf-mono">{item.weight}</span>,
      attestations: <span className="sf-mono">{item.attestations}</span>,
      status: item.penaltyPending ? (
        <Chip className="sf-chip--danger">{copy.dispute.penaltyPending}</Chip>
      ) : (
        <span className="sf-list__muted">{copy.guardians.noPenalty}</span>
      ),
    },
  }
}

/**
 * The highest score first.
 *
 * The order is the order of the server, so a Guardian keeps its place between the pages. The
 * votes and the address break a tie.
 */
function highestScoreFirst(items: readonly GuardianSummary[]): GuardianSummary[] {
  return [...items].sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score
    if (left.attestations !== right.attestations) return right.attestations - left.attestations
    return left.address.localeCompare(right.address)
  })
}

/** The list of the Guardians of the registry. */
export function GuardiansList({ page }: GuardiansListProps) {
  const query = useQuery({
    queryKey: ['guardians', page],
    queryFn: () => loadGuardians({ page, limit: PAGE_SIZE }),
    retry: false,
  })
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = query.data === undefined ? [] : highestScoreFirst(query.data.items)
  const failed = query.isError && query.data === undefined

  return (
    <div className="sf-list-page">
      <header className="sf-list-page__head">
        <div className="sf-list-page__title">
          <h1>{copy.guardians.title}</h1>
          <p className="sf-lead">{copy.guardians.intro}</p>
        </div>
      </header>
      {query.isPending && <Skeleton label={copy.common.loading} rows={5} />}
      {failed && <ErrorState what={copy.guardians.failed} onChainSafe onRetry={() => void query.refetch()} />}
      {!query.isPending && !failed && items.length === 0 && (
        <EmptyState
          title={copy.guardians.empty}
          action={
            <Link className="sf-btn sf-btn--secondary" href="/app">
              {copy.explore.scanTarget}
            </Link>
          }
        />
      )}
      {!query.isPending && items.length > 0 && (
        <TargetTable
          caption={copy.guardians.caption}
          columns={COLUMNS}
          rows={items.map(rowOf)}
          footer={
            <>
              <span className="sf-mono">
                {(total === 1 ? copy.guardians.countOne : copy.guardians.count).replace('{count}', String(total))}
              </span>
              {query.data?.finalizedBlock !== null && query.data?.finalizedBlock !== undefined && (
                <span className="sf-mono sf-list__muted">
                  {copy.guardians.indexedTo.replace('{block}', query.data.finalizedBlock)}
                </span>
              )}
              <PageLinks
                page={page}
                pages={pages}
                href={hrefOf}
                labels={{
                  page: copy.guardians.page,
                  pagination: copy.guardians.pagination,
                  previous: copy.guardians.previous,
                  next: copy.guardians.next,
                }}
              />
            </>
          }
        />
      )}
    </div>
  )
}
