'use client'
import type { Address } from 'viem'
import { modulesLive } from '../../lib/chain/config'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { WithdrawButton } from './WithdrawButton'

export type BalanceProps = {
  account: Address | null
  /** The balance the vault holds, in wei. Null while it is not read. */
  balance: bigint | null
  /** Called once the withdrawal was mined, so the balance is read again. */
  onWithdrawn: () => void
}

/**
 * The balance that can be taken out of the vault.
 *
 * The balance is read from the vault and not from the indexer, so it is the number the contract
 * would send. A balance of zero is not offered as a withdrawal: the call would revert.
 */
export function Balance({ account, balance, onWithdrawn }: BalanceProps) {
  const empty = balance !== null && balance === 0n
  return (
    <section className="sf-frame" aria-label={copy.activity.balance}>
      <div className="sf-panel__head"><h2>{copy.activity.balanceToWithdraw}</h2></div>
      <div className="sf-balance">
        <p className="sf-balance__amount">
          {balance === null ? copy.common.loading : formatBnb(balance)}{' '}
          <span className="sf-balance__unit">BNB</span>
        </p>
        {empty && <p className="sf-lead">{copy.activity.balanceEmpty}</p>}
        {account !== null && balance !== null && !empty && (
          <WithdrawButton account={account} balance={balance} onWithdrawn={onWithdrawn} disabled={!modulesLive} />
        )}
        {!modulesLive && <p className="sf-lead">{copy.common.modulesNotLive}</p>}
      </div>
    </section>
  )
}
