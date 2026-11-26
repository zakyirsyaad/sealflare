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
import { notifyActivityChanged } from '../../../lib/activity/activityChanged'
import { useActivity } from '../../../lib/activity/useActivity'
import { usePendingPenalties, useStanding, useVaultBalance } from '../../../lib/activity/useChainReads'
import { agentIdUrl } from '../../../lib/chain/config'
import { useUserState } from '../../../lib/chain/userState'
import { copy } from '../../../lib/copy'

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
  return <ActivityView address={address} agentId={agentIdOf(user)} />
}

/** The way to get an Agent ID, when the wallet does not hold one. */
function agentIdOf(user: ReturnType<typeof useUserState>): { recheck: () => void } | null {
  if (user.kind !== 'no-agent-id') return null
  return { recheck: user.recheck }
}

/** The screen of an account that is connected. */
function ActivityView({ address, agentId }: { address: `0x${string}`; agentId: { recheck: () => void } | null }) {
  const { mutate: disconnect } = useDisconnect()
  const activity = useActivity(address)
  const balance = useVaultBalance(address)
  const standing = useStanding(address)
  const attested = attestedTargets(activity.history)
  const penalties = usePendingPenalties(attested.targets)
  const onApplied = useCallback(() => {
    penalties.refetch()
    notifyActivityChanged()
  }, [penalties.refetch])
  const onSettled = useCallback(() => {
    activity.reload()
    notifyActivityChanged()
  }, [activity.reload])
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
          agentId={agentId}
          onOtherWallet={disconnect}
          onApplied={onApplied}
          onSettled={onSettled}
        />
        <ActivitySide address={address} balance={balance} standing={standing} holder={agentId === null} />
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
  agentId,
  onOtherWallet,
  onApplied,
  onSettled,
}: {
  address: `0x${string}`
  activity: ReturnType<typeof useActivity>
  attested: { targets: string[]; limited: boolean }
  penalties: ReturnType<typeof usePendingPenalties>
  pending: PendingPenalty[]
  agentId: { recheck: () => void } | null
  onOtherWallet: () => void
  onApplied: () => void
  onSettled: () => void
}) {
  return (
    <div className="sf-activity__main">
      {agentId !== null && (
        <NoAgentId recheck={agentId.recheck} onOtherWallet={onOtherWallet} agentIdUrl={agentIdUrl} />
      )}
      <NeedsAction account={address} items={activity.needsAction} onSettled={onSettled} />
      {penalties.failed && attested.targets.length > 0 && (
        <ErrorState what={copy.activity.penaltiesFailed} onChainSafe onRetry={penalties.refetch} />
      )}
      <PenaltiesPanel
        account={address}
        penalties={pending}
        updatedAt={penalties.updatedAt}
        failed={penalties.failed}
        onApplied={onApplied}
      />
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

/** The column of the balance of the account and of its standing. */
function ActivitySide({
  address,
  balance,
  standing,
  holder,
}: {
  address: `0x${string}`
  balance: ReturnType<typeof useVaultBalance>
  standing: ReturnType<typeof useStanding>
  /** The standing belongs to a holder of an Agent ID, so only a holder has one. */
  holder: boolean
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
      {holder && (
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
  history: ReturnType<typeof useActivity>['history']
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
function attestedTargets(history: ReturnType<typeof useActivity>['history']): {
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
