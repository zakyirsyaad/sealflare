'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AddressSchema, type ActivityItem } from '@sealflare/shared/schemas'
import type { Weight } from '@sealflare/shared/rules'
import { ApiError } from '../../lib/api/client'
import { loadGuardian } from '../../lib/api/lists'
import { copy } from '../../lib/copy'
import { shortAddress, timeAgo, verdictLabel } from '../../lib/format'
import { useNow } from '../dispute/useNow'
import { TargetTable, type TableColumn, type TableRow } from '../target/TargetTable'
import { Chip } from '../ui/Chip'
import { ErrorState, EmptyState } from '../ui'
import { Skeleton } from '../ui/Skeleton'

/** The highest vote weight of the frozen rules. */
const MAX_WEIGHT: Weight = 5

export type GuardianProfileProps = {
  address: string
}

/** The columns of the history of a Guardian. */
const COLUMNS: readonly TableColumn[] = [
  { key: 'what', label: copy.guardians.historyColumns.what },
  { key: 'target', label: copy.guardians.historyColumns.target },
  { key: 'result', label: copy.guardians.historyColumns.result },
  { key: 'reputation', label: copy.guardians.historyColumns.reputation },
  { key: 'when', label: copy.guardians.historyColumns.when },
]

/** The word a kind of activity is shown under. */
function kindOf(item: ActivityItem): string {
  return copy.guardians.kinds[item.kind]
}

/**
 * What an entry says.
 *
 * An attestation carries the verdict of the vote, so it is shown in words. Every other entry
 * carries a sentence already.
 */
function resultOf(item: ActivityItem): string {
  if (item.kind !== 'attestation') return item.result
  if (item.result !== 'SAFE' && item.result !== 'CAUTION' && item.result !== 'DANGER') return item.result
  return verdictLabel(item.result)
}

/** The reputation a row earned. A row that earned nothing yet says so. */
function reputationOf(item: ActivityItem): string {
  if (item.xp === null) return copy.guardians.pending
  return item.xp > 0 ? `+${item.xp}` : String(item.xp)
}

/** One row of the history. */
function rowOf(item: ActivityItem, index: number, now: Date): TableRow {
  return {
    id: `${item.targetId}-${index}`,
    cells: {
      what: <span>{kindOf(item)}</span>,
      target: (
        <Link className="sf-mono sf-list__name" href={`/app/t/${item.targetId}`}>
          {item.label}
        </Link>
      ),
      result: <span className="sf-mono">{resultOf(item)}</span>,
      reputation: <span className="sf-mono">{reputationOf(item)}</span>,
      when: (
        <span className="sf-list__muted" suppressHydrationWarning>
          {timeAgo(item.at, now)}
        </span>
      ),
    },
  }
}

/** The facts of a Guardian: its score, its weight and the penalty that waits. */
function Standing({ guardian }: { guardian: { score: number; weight: number; attestations: number; penaltyPending: boolean } }) {
  return (
    <section className="sf-frame sf-guardian" aria-label={copy.guardians.standing}>
      <div className="sf-guardian__facts">
        <div className="sf-guardian__fact">
          <span className="sf-mono sf-guardian__label">{copy.guardians.columns.score}</span>
          <span className="sf-mono sf-guardian__value">{guardian.score}</span>
        </div>
        <div className="sf-guardian__fact">
          <span className="sf-mono sf-guardian__label">{copy.guardians.columns.weight}</span>
          <span className="sf-mono sf-guardian__value">
            {copy.guardians.voteWeight.replace('{weight}', String(guardian.weight)).replace('{max}', String(MAX_WEIGHT))}
          </span>
        </div>
        <div className="sf-guardian__fact">
          <span className="sf-mono sf-guardian__label">{copy.guardians.columns.attestations}</span>
          <span className="sf-mono sf-guardian__value">{guardian.attestations}</span>
        </div>
        {guardian.penaltyPending && (
          <div className="sf-guardian__fact">
            <span className="sf-mono sf-guardian__label">{copy.guardians.columns.status}</span>
            <Chip className="sf-chip--danger">{copy.dispute.penaltyPending}</Chip>
          </div>
        )}
      </div>
    </section>
  )
}

/** The profile of one Guardian: its standing and what it did. */
export function GuardianProfile({ address }: GuardianProfileProps) {
  const parsed = AddressSchema.safeParse(address)
  const query = useQuery({
    queryKey: ['guardian', address],
    queryFn: () => loadGuardian(address),
    retry: false,
    enabled: parsed.success,
  })
  const now = useNow()
  const missing = query.error instanceof ApiError && query.error.code === 'NOT_FOUND'

  if (!parsed.success || missing) {
    return (
      <div className="sf-list-page">
        <EmptyState
          title={copy.guardians.notFound}
          action={
            <Link className="sf-btn sf-btn--secondary" href="/app/guardians">
              {copy.guardians.title}
            </Link>
          }
        />
      </div>
    )
  }
  if (query.isPending) {
    return (
      <div className="sf-list-page" aria-busy="true">
        <Skeleton label={copy.common.loading} />
      </div>
    )
  }
  if (query.isError || query.data === undefined) {
    return (
      <div className="sf-list-page">
        <ErrorState what={copy.guardians.failedProfile} onChainSafe onRetry={() => void query.refetch()} />
      </div>
    )
  }

  const guardian = query.data.item
  return (
    <div className="sf-list-page">
      <header className="sf-list-page__head">
        <div className="sf-list-page__title">
          <h1 className="sf-mono">{shortAddress(guardian.address)}</h1>
          <p className="sf-lead">{copy.guardians.introProfile}</p>
        </div>
      </header>
      <Standing guardian={guardian} />
      <TargetTable
        caption={copy.guardians.historyCaption}
        columns={COLUMNS}
        rows={guardian.history.map((item, index) => rowOf(item, index, now))}
        footer={
          <span className="sf-mono">
            {copy.guardians.historyCount.replace('{count}', String(guardian.history.length))}
          </span>
        }
      />
    </div>
  )
}
