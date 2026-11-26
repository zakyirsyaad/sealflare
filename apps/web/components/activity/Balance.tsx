'use client'
import type { Address } from 'viem'
import { modulesLive } from '../../lib/chain/config'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { WithdrawButton } from './WithdrawButton'

export type BalanceProps = {
  account: Address | null
  /** The balance the vault holds, in wei. Null while it is not read. */
  balance: bigint | null
  /** The chain could not be read, so there is no balance to show. */
  failed: boolean
  /** Called once the withdrawal was mined, so the balance is read again. */
  onWithdrawn: () => void
  /** Called when the reader asks for the balance again. */
  onRetry: () => void
}

/**
 * The balance that can be taken out of the vault.
 *
 * The balance is read from the vault and not from the indexer, so it is the number the contract
 * would send. A balance of zero is not offered as a withdrawal: the call would revert. A read
 * that fails is shown as a failure, not as a balance of zero. While the vault is not open yet,
 * the panel says so instead of failing: the vault is not there to be read.
 */
export function Balance({ account, balance, failed, onWithdrawn, onRetry }: BalanceProps) {
  const empty = balance !== null && balance === 0n
  return (
    <section className="sf-frame" aria-label={copy.activity.balance}>
      <div className="sf-panel__head"><h2>{copy.activity.balanceToWithdraw}</h2></div>
      <div className="sf-balance">
        {failed ? (
          <ErrorState what={copy.activity.balanceFailed} onChainSafe onRetry={onRetry} />
        ) : balance === null ? (
          modulesLive ? <Skeleton label={copy.common.loading} /> : <p className="sf-lead">{copy.common.modulesNotLive}</p>
        ) : (
          <>
            <p className="sf-balance__amount">
              {formatBnb(balance)} <span className="sf-balance__unit">{copy.common.bnb}</span>
            </p>
            {empty && <p className="sf-lead">{copy.activity.balanceEmpty}</p>}
            {account !== null && balance !== null && !empty && (
              <WithdrawButton account={account} balance={balance} onWithdrawn={onWithdrawn} disabled={!modulesLive} />
            )}
            {!modulesLive && <p className="sf-lead">{copy.common.modulesNotLive}</p>}
          </>
        )}
      </div>
    </section>
  )
}
