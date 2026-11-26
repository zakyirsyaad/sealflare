'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { TARGET_TYPES, type TargetType } from '@sealflare/shared/rules'
import type { TargetSummary } from '@sealflare/shared/schemas'
import { ApiError } from '../../lib/api/client'
import { loadTargets } from '../../lib/api/lists'
import { copy } from '../../lib/copy'
import { formatBnb, shortAddress, tierLabel, timeAgo } from '../../lib/format'
import type { Verdict } from '../../lib/verdict'
import { useNow } from '../dispute/useNow'
import { PageLinks } from '../target/PageLinks'
import { TargetTable, type TableColumn, type TableRow } from '../target/TargetTable'
import { ErrorState, EmptyState } from '../ui'
import { SealMark } from '../ui/SealMark'
import { Skeleton } from '../ui/Skeleton'

/** How many targets one page of the list holds. */
export const PAGE_SIZE = 20

export type ExploreListProps = {
  /** The kind of target the list shows, or null when it shows every kind. */
  kind: TargetType | null
  /** The verdict the list is filtered by, or null when it is not filtered. */
  verdict: Verdict | null
  page: number
}

/** The columns of the target list. The three vote counts are always there, never one score. */
const COLUMNS: readonly TableColumn[] = [
  { key: 'target', label: copy.explore.columns.target },
  { key: 'verdict', label: copy.explore.columns.verdict },
  { key: 'safe', label: copy.explore.columns.safe },
  { key: 'caution', label: copy.explore.columns.caution },
  { key: 'danger', label: copy.explore.columns.danger },
  { key: 'publisher', label: copy.explore.columns.publisher },
  { key: 'lastVote', label: copy.explore.columns.lastVote },
]

/** The word each kind of target is shown under. */
const KIND_WORDS: Record<TargetType, string> = {
  SMART_CONTRACT: copy.explore.kindContracts,
  AI_SKILL_BUNDLE: copy.explore.kindSkills,
}

/** The kinds the list can be filtered by, taken from the frozen kinds of a target. */
const KINDS: { value: TargetType | null; label: string }[] = [
  { value: null, label: copy.explore.kindAll },
  ...TARGET_TYPES.map(type => ({ value: type, label: KIND_WORDS[type] })),
]

/** The verdicts the list can be filtered by. */
const VERDICTS: { value: Verdict | null; label: string }[] = [
  { value: null, label: copy.explore.verdictAny },
  { value: 'SAFE', label: copy.explore.verdictSafe },
  { value: 'CAUTION', label: copy.explore.verdictCaution },
  { value: 'DANGER', label: copy.explore.verdictDanger },
]

/** The address of the list with a filter in it. The query is the state of the page. */
function hrefOf(state: ExploreListProps, changes: Partial<{ kind: TargetType | null; verdict: Verdict | null; page: number }>): string {
  const kind = changes.kind === undefined ? state.kind : changes.kind
  const verdict = changes.verdict === undefined ? state.verdict : changes.verdict
  const page = changes.page === undefined ? state.page : changes.page
  const params = new URLSearchParams()
  if (kind !== null) params.set('kind', kind)
  if (verdict !== null) params.set('verdict', verdict)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query === '' ? '/app/explore' : `/app/explore?${query}`
}

/** The name a target is shown under: an address for a contract, the repository for a skill. */
function nameOf(item: TargetSummary): string {
  return item.targetType === 'SMART_CONTRACT' ? shortAddress(item.label) : item.label
}

/** What the publisher column says. A bond is only named when there is one. */
function publisherOf(item: TargetSummary): string {
  const role =
    item.publisherRole === 'NONE'
      ? copy.target.notClaimed
      : item.publisherRole === 'VERIFIED_PUBLISHER'
        ? copy.publish.verifiedPublisher
        : copy.publish.sponsor
  if (item.bond === '0') return role
  return `${role}, ${copy.explore.bond.replace('{amount}', formatBnb(item.bond))}`
}

/** One row of the list. */
function rowOf(item: TargetSummary, now: Date): TableRow {
  return {
    id: item.targetId,
    cells: {
      target: (
        <>
          <Link className="sf-mono sf-list__name" href={`/app/t/${item.targetId}`}>
            {nameOf(item)}
          </Link>
          <span className="sf-list__kind">{item.targetType === 'SMART_CONTRACT' ? copy.target.contract : copy.target.skill}</span>
        </>
      ),
      verdict: (
        <span className="sf-list__verdict">
          {/* The word beside the mark says the same thing, so the mark is only a picture here. */}
          <span aria-hidden="true">
            <SealMark tier={item.tier} size={24} showLabel={false} />
          </span>
          <span>{tierLabel(item.tier)}</span>
        </span>
      ),
      safe: <span className="sf-mono">{item.safe}</span>,
      caution: <span className="sf-mono">{item.caution}</span>,
      danger: <span className="sf-mono">{item.danger}</span>,
      publisher: <span>{publisherOf(item)}</span>,
      lastVote: (
        <span className="sf-list__muted" suppressHydrationWarning>
          {item.lastVoteAt === null ? copy.explore.noVotes : timeAgo(item.lastVoteAt, now)}
        </span>
      ),
    },
  }
}

/**
 * The newest vote first.
 *
 * The list is cut by the server, so the order inside a page does not change what a page holds.
 * A target that was never voted on comes last.
 */
function newestFirst(items: readonly TargetSummary[]): TargetSummary[] {
  return [...items].sort((left, right) => {
    const leftAt = left.lastVoteAt === null ? 0 : Date.parse(left.lastVoteAt)
    const rightAt = right.lastVoteAt === null ? 0 : Date.parse(right.lastVoteAt)
    if (leftAt !== rightAt) return rightAt - leftAt
    return left.targetId.localeCompare(right.targetId)
  })
}

/** The group of filter buttons. */
function FilterGroup<T extends string | null>({
  label,
  options,
  current,
  href,
}: {
  label: string
  options: { value: T; label: string }[]
  current: T
  href: (value: T) => string
}) {
  return (
    <div className="sf-seg" role="group" aria-label={label}>
      {options.map(option => (
        <Link key={option.value ?? 'all'} className="sf-seg__option" href={href(option.value)} aria-current={option.value === current ? 'true' : undefined}>
          {option.label}
        </Link>
      ))}
    </div>
  )
}

/** The head of the list: the name of the screen and the two filters. */
function ListHead({ state }: { state: ExploreListProps }) {
  return (
    <header className="sf-list-page__head">
      <div className="sf-list-page__title">
        <h1>{copy.explore.title}</h1>
        <p className="sf-lead">{copy.explore.intro}</p>
      </div>
      <FilterGroup label={copy.explore.kindLabel} options={KINDS} current={state.kind} href={value => hrefOf(state, { kind: value, page: 1 })} />
      <FilterGroup label={copy.explore.verdictLabel} options={VERDICTS} current={state.verdict} href={value => hrefOf(state, { verdict: value, page: 1 })} />
    </header>
  )
}

/** The list of the targets of the registry. */
export function ExploreList({ kind, verdict, page }: ExploreListProps) {
  const state: ExploreListProps = { kind, verdict, page }
  const query = useQuery({
    queryKey: ['targets', kind, verdict, page],
    queryFn: () => loadTargets({ page, limit: PAGE_SIZE, type: kind ?? undefined, verdict: verdict ?? undefined }),
    retry: false,
  })
  const now = useNow()
  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const items = query.data === undefined ? [] : newestFirst(query.data.items)
  const failed = query.isError && query.data === undefined
  const tooMany = query.error instanceof ApiError && query.error.code === 'BAD_REQUEST'

  return (
    <div className="sf-list-page">
      <ListHead state={state} />
      {query.isPending && <Skeleton label={copy.common.loading} rows={5} />}
      {failed && <ErrorState what={tooMany ? copy.explore.tooMany : copy.explore.failed} onChainSafe onRetry={() => void query.refetch()} />}
      {!query.isPending && !failed && items.length === 0 && (
        <EmptyState
          title={copy.explore.empty}
          action={
            <Link className="sf-btn sf-btn--secondary" href={kind === null && verdict === null ? '/app' : '/app/explore'}>
              {kind === null && verdict === null ? copy.explore.scanTarget : copy.explore.clearFilter}
            </Link>
          }
        />
      )}
      {!query.isPending && items.length > 0 && (
        <TargetTable
          caption={copy.explore.caption}
          columns={COLUMNS}
          rows={items.map(item => rowOf(item, now))}
          footer={
            <>
              <span className="sf-mono">
                {(total === 1 ? copy.explore.countOne : copy.explore.count).replace('{count}', String(total))}
              </span>
              {query.data?.finalizedBlock !== null && query.data?.finalizedBlock !== undefined && (
                <span className="sf-mono sf-list__muted">
                  {copy.explore.indexedTo.replace('{block}', query.data.finalizedBlock)}
                </span>
              )}
              <PageLinks
                page={page}
                pages={pages}
                href={next => hrefOf(state, { page: next })}
                labels={{
                  page: copy.explore.page,
                  pagination: copy.explore.pagination,
                  previous: copy.explore.previous,
                  next: copy.explore.next,
                }}
              />
            </>
          }
        />
      )}
    </div>
  )
}
