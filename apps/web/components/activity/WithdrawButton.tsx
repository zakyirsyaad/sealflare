'use client'
import { useEffect, useRef } from 'react'
import type { Address } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { vaultAddress } from '../../lib/chain/addresses'
import { useWriteTx } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { ActionButton } from './ActionButton'

export type WithdrawButtonProps = {
  account: Address
  /** The balance the vault holds for the account, in wei. */
  balance: bigint
  /** Called once the withdrawal was mined, so the balance is read again. */
  onWithdrawn: () => void
  /** The vault is not open yet, so the action cannot be used. */
  disabled?: boolean
}

/**
 * The button that takes the whole balance out of the vault.
 *
 * The vault sends the whole balance of the account, so there is no amount to choose. A balance of
 * zero is not offered at all: the call would revert and cost gas for nothing.
 */
export function WithdrawButton({ account, balance, onWithdrawn, disabled = false }: WithdrawButtonProps) {
  const tx = useWriteTx()
  const vault = vaultAddress()
  const mined = useRef<string | null>(null)
  const { state, txHash } = tx
  useEffect(() => {
    if (state !== 'done' || txHash === null || mined.current === txHash) return
    mined.current = txHash
    onWithdrawn()
  }, [state, txHash, onWithdrawn])
  if (balance === 0n) return null
  const send = () => {
    if (vault === null || balance === 0n) return
    void tx.send({ account, address: vault, abi: vaultAbi, functionName: 'withdraw', args: [] })
  }
  return (
    <div className="sf-stack">
      <ActionButton
        label={copy.activity.withdraw}
        state={tx.state}
        error={tx.error}
        txHash={tx.txHash}
        disabled={disabled || vault === null}
        onSubmit={send}
      />
      <p className="sf-lead">{copy.activity.withdrawGas}</p>
    </div>
  )
}
