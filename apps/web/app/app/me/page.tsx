'use client'
import { useState } from 'react'
import { Balance } from '../../../components/activity/Balance'
import { History } from '../../../components/activity/History'
import { NeedsAction } from '../../../components/activity/NeedsAction'
import { Standing } from '../../../components/activity/Standing'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Skeleton } from '../../../components/ui/Skeleton'
import { ConnectPrompt } from '../../../components/wallet/ConnectPrompt'
import { WrongNetwork } from '../../../components/wallet/WrongNetwork'
import { useActivity } from '../../../lib/activity/useActivity'
import { usePendingPenalties, useStanding, useVaultBalance } from '../../../lib/activity/useChainReads'
import { useUserState } from '../../../lib/chain/userState'
import { copy } from '../../../lib/copy'

/**
 * My activity: what waits on the account, what it may withdraw and what it did.
 *
 * The page asks for a wallet and shows nothing personal without one. The balance and the standing
 * come from the chain, and the actions come from the indexed rows of the account.
 */
export default function MyActivityPage() {
  const user = useUserState()
  const address = 'address' in user ? user.address : null
  const activity = useActivity(address)
  const balance = useVaultBalance(address)
  const standing = useStanding(address)
  const targets = attestedTargets(activity.history)
  const penalties = usePendingPenalties(targets)
  const [prompt, setPrompt] = useState(false)

  if (user.kind === 'wrong-network') {
    return (
      <div className="sf-stack">
        <h1 className="sf-identity__label">{copy.activity.title}</h1>
        <p className="sf-lead">{copy.activity.needWallet}</p>
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

  const pending = targets
    .filter(target => (penalties.pending[target] ?? 0) > 0)
    .map(target => ({ targetId: target, pending: penalties.pending[target] ?? 0 }))

  return (
    <div className="sf-activity">
      <h1 className="sf-identity__label">{copy.activity.title}</h1>
      <div className="sf-activity__body">
        <div className="sf-activity__main">
          {(activity.needsAction.length > 0 || pending.length > 0) && (
            <NeedsAction
              account={address}
              items={activity.needsAction}
              penalties={pending}
              onApplied={penalties.refetch}
            />
          )}
          <HistoryPanel
            history={activity.history}
            loading={activity.loading}
            failed={activity.failed}
            onRetry={activity.reload}
          />
        </div>
        <div className="sf-activity__side">
          <Balance account={address} balance={balance.wei} onWithdrawn={balance.refetch} />
          <Standing {...standing} />
        </div>
      </div>
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
function attestedTargets(history: ReturnType<typeof useActivity>['history']): string[] {
  const targets: string[] = []
  for (const item of history) {
    if (item.kind !== 'attestation') continue
    if (!targets.includes(item.targetId)) targets.push(item.targetId)
  }
  return targets.slice(0, 20)
}
