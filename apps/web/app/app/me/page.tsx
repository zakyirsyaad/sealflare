'use client'
import { useCallback, useState } from 'react'
import { useDisconnect } from 'wagmi'
import { Balance } from '../../../components/activity/Balance'
import { History } from '../../../components/activity/History'
import { NeedsAction } from '../../../components/activity/NeedsAction'
import { PenaltiesPanel, type PendingPenalty } from '../../../components/activity/PenaltiesPanel'
import { Standing } from '../../../components/activity/Standing'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { ConnectPrompt } from '../../../components/wallet/ConnectPrompt'
import { NoAgentId } from '../../../components/wallet/NoAgentId'
import { WrongNetwork } from '../../../components/wallet/WrongNetwork'
import { useSharedActivity } from '../../../lib/activity/ActivityProvider'
import { notifyActivityChanged } from '../../../lib/activity/activityChanged'
import { usePendingPenalties, useStanding, useVaultBalance } from '../../../lib/activity/useChainReads'
import { useReloadLater } from '../../../lib/activity/useReloadLater'
import { agentIdUrl } from '../../../lib/chain/config'
import { useUserState } from '../../../lib/chain/userState'
import { copy } from '../../../lib/copy'
import { shortAddress } from '../../../lib/format'

/** How many targets of the account are read for the penalties that wait on them. */
const MAX_PENALTY_TARGETS = 20

/**
 * My activity: what waits on the account, what it may withdraw and what it did.
 *
 * The page asks for a wallet and shows nothing personal without one. The balance and the standing
 * come from the chain, and the actions come from the indexed rows of the account.
 */
export default function MyActivityPage() {
  const user = useUserState()
  const address = 'address' in user ? user.address : null
  const [prompt, setPrompt] = useState(false)

  if (user.kind === 'wrong-network') {
    return (
      <div className="sf-stack">
        <h1 className="sf-identity__label">{copy.activity.title}</h1>
        <p className="sf-lead">{copy.activity.wrongNetwork}</p>
        <WrongNetwork />
      </div>
    )
  }
  if (address === null) {
    return (
      <div className="sf-stack">
        <h1 className="sf-identity__label">{copy.activity.title}</h1>
        <p className="sf-lead">{copy.activity.needWallet}</p>
        <Button onClick={() => setPrompt(true)}>{copy.nav.connectWallet}</Button>
        {prompt && <ConnectPrompt onClose={() => setPrompt(false)} />}
      </div>
    )
  }
  return <ActivityView address={address} noAgentId={agentIdOf(user)} />
}

/** The way to get an Agent ID, when the wallet does not hold one. */
function agentIdOf(user: ReturnType<typeof useUserState>): { recheck: () => void } | null {
  if (user.kind !== 'no-agent-id') return null
  return { recheck: user.recheck }
}

/** The screen of an account that is connected. */
function ActivityView({ address, noAgentId }: { address: `0x${string}`; noAgentId: { recheck: () => void } | null }) {
  const { mutate: disconnect } = useDisconnect()
  // The rows of the account are read once for the whole application, so the page and the mark on
  // the wallet button always count the same rows.
  const activity = useSharedActivity()
  const balance = useVaultBalance(address)
  const standing = useStanding(address)
  const attested = attestedTargets(activity.history)
  const penalties = usePendingPenalties(attested.targets)
  const reloadLater = useReloadLater(activity.reload)
  const [report, setReport] = useState<{ targetId: string; applied: number } | null>(null)
  const onApplied = useCallback(
    async (targetId: string, before: number) => {
      // The number that is left is read again, and the answer of that read is the one the page is
      // measured against, so the report is never a guess.
      const counts = await penalties.refresh()
      notifyActivityChanged()
      if (counts === null) return
      setReport({ targetId, applied: before - (counts[targetId] ?? 0) })
    },
    [penalties.refresh],
  )
  const onSettled = useCallback(() => {
    // The claim changed the score of the account on the chain, so the standing is read again.
    standing.refetch()
    // The indexer reads the transaction when its block is final, so the rows are read again later.
    reloadLater()
    notifyActivityChanged()
  }, [standing.refetch, reloadLater])
  const pending = attested.targets
    .filter(target => (penalties.pending[target]?.pending ?? 0) > 0)
    .map(target => ({
      targetId: target,
      pending: penalties.pending[target]?.pending ?? 0,
      attestations: penalties.pending[target]?.attestations ?? null,
    }))
  return (
    <div className="sf-activity">
      <h1 className="sf-identity__label">{copy.activity.title}</h1>
      <div className="sf-activity__body">
        <ActivityMain
          address={address}
          activity={activity}
          attested={attested}
          penalties={penalties}
          pending={pending}
          report={report}
          noAgentId={noAgentId}
          onOtherWallet={disconnect}
          onApplied={onApplied}
          onSettled={onSettled}
        />
        <ActivitySide address={address} balance={balance} standing={standing} hasAgentId={noAgentId === null} />
      </div>
    </div>
  )
}

/** The column of the things that wait on the account, and of what it did. */
function ActivityMain({
  address,
  activity,
  attested,
  penalties,
  pending,
  report,
  noAgentId,
  onOtherWallet,
  onApplied,
  onSettled,
}: {
  address: `0x${string}`
  activity: ReturnType<typeof useSharedActivity>
  attested: { targets: string[]; limited: boolean }
  penalties: ReturnType<typeof usePendingPenalties>
  pending: PendingPenalty[]
  report: { targetId: string; applied: number } | null
  noAgentId: { recheck: () => void } | null
  onOtherWallet: () => void
  onApplied: (targetId: string, before: number) => void
  onSettled: () => void
}) {
  return (
    <div className="sf-activity__main">
      {noAgentId !== null && (
        <NoAgentId recheck={noAgentId.recheck} onOtherWallet={onOtherWallet} agentIdUrl={agentIdUrl} />
      )}
      <NeedsAction account={address} items={activity.needsAction} now={activity.now} onSettled={onSettled} />
      {penalties.failed && attested.targets.length > 0 && (
        <ErrorState what={copy.activity.penaltiesFailed} onChainSafe onRetry={penalties.refetch} />
      )}
      <PenaltiesPanel
        account={address}
        penalties={pending}
        updatedAt={penalties.updatedAt}
        failed={penalties.failed}
        viewsFailed={penalties.viewsFailed}
        onApplied={onApplied}
        onRetry={penalties.refetch}
      />
      {report !== null && <p className="sf-lead">{reportText(report)}</p>}
      {attested.limited && (
        <p className="sf-lead">
          {copy.activity.penaltiesLimited.replace('{count}', String(MAX_PENALTY_TARGETS))}
        </p>
      )}
      <HistoryPanel
        history={activity.history}
        loading={activity.loading}
        failed={activity.failed}
        onRetry={activity.reload}
      />
    </div>
  )
}

/**
 * What the last page of penalties applied.
 *
 * The report lives in the page and not in the row, because a page that clears a target takes the
 * row with it, and the reader still has to read what the page did.
 */
function reportText(report: { targetId: string; applied: number }): string {
  const target = shortAddress(report.targetId)
  if (report.applied === 0) return copy.activity.penaltiesNoneTarget.replace('{target}', target)
  if (report.applied === 1) return copy.activity.penaltiesAppliedOneTarget.replace('{target}', target)
  return copy.activity.penaltiesAppliedTarget.replace('{count}', String(report.applied)).replace('{target}', target)
}

/** The column of the balance of the account and of its standing. */
function ActivitySide({
  address,
  balance,
  standing,
  hasAgentId,
}: {
  address: `0x${string}`
  balance: ReturnType<typeof useVaultBalance>
  standing: ReturnType<typeof useStanding>
  /** The standing belongs to a holder of an Agent ID, so only a holder has one. */
  hasAgentId: boolean
}) {
  return (
    <div className="sf-activity__side">
      <Balance
        account={address}
        balance={balance.wei}
        failed={balance.failed}
        onWithdrawn={balance.refetch}
        onRetry={balance.refetch}
      />
      {hasAgentId && (
        <Standing
          score={standing.score}
          weight={standing.weight}
          toNextWeight={standing.toNextWeight}
          attestationsLeft={standing.attestationsLeft}
          failed={standing.failed}
          onRetry={standing.refetch}
        />
      )}
    </div>
  )
}

/**
 * The history of the account, or the state the panel is in.
 *
 * An account with no history sees one invitation: scan a first target.
 */
function HistoryPanel({
  history,
  loading,
  failed,
  onRetry,
}: {
  history: ReturnType<typeof useSharedActivity>['history']
  loading: boolean
  failed: boolean
  onRetry: () => void
}) {
  if (failed) return <ErrorState what={copy.activity.failed} onChainSafe onRetry={onRetry} />
  if (loading) return <Skeleton />
  if (history.length === 0) {
    return (
      <EmptyState
        title={copy.activity.noHistory}
        action={
          <a className="sf-btn sf-btn--secondary" href="/app">
            {copy.activity.scanFirst}
          </a>
        }
      />
    )
  }
  return <History items={history} />
}

/** The targets the account attested on, where a penalty may still be waiting. */
function attestedTargets(history: ReturnType<typeof useSharedActivity>['history']): {
  targets: string[]
  limited: boolean
} {
  const targets: string[] = []
  for (const item of history) {
    if (item.kind !== 'attestation') continue
    if (!targets.includes(item.targetId)) targets.push(item.targetId)
  }
  return {
    targets: targets.slice(0, MAX_PENALTY_TARGETS),
    limited: targets.length > MAX_PENALTY_TARGETS,
  }
}
