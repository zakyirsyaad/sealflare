'use client'
import { useCallback, useState } from 'react'
import type { Address, Hex } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { useWriteTx, type TxState } from '../chain/useWriteTx'
import { copy } from '../copy'
import { vaultAddress } from '../publish/useBond'
import { withinBountyBounds } from './settle'

/** The states of a bounty write. They are the states of every write of the app. */
export type BountyStatus = TxState

export type BountyWrite = {
  status: BountyStatus
  error: string | null
  /** The hash of the transaction, as soon as the wallet has signed it. */
  txHash: Hex | null
}

/**
 * The writes of the bounties.
 *
 * A bounty is BNB that goes straight to the vault, so no token is ever approved. The wallet of
 * the visitor signs every write, and the server signs nothing.
 *
 * Every request names the account that signs it, so a wallet that switched account between the
 * form and the signature refuses instead of sending as another account. The write goes through
 * the shared hook, so a transaction the wallet cancelled or replaced is a failure and never a
 * success, and the hash that is kept is the hash of the transaction that was mined.
 */
export function useBounty() {
  const tx = useWriteTx()
  // A reason the app found before the wallet was asked. It holds no hash, because nothing was
  // sent on-chain, so the reader may try again.
  const [refusal, setRefusal] = useState<string | null>(null)

  /** The bounty of one target, with the slots it offers and the money it holds. */
  const createBounty = useCallback(
    async (account: Address, targetId: Hex, slots: number, amount: bigint): Promise<void> => {
      const vault = vaultAddress()
      if (vault === null) {
        setRefusal(copy.bounty.vaultMissing)
        return
      }
      // The panel checks the bounds as well, but a write never leaves the app without them.
      if (!withinBountyBounds(slots, amount)) {
        setRefusal(copy.bounty.boundsInvalid)
        return
      }
      setRefusal(null)
      await tx.send({
        account,
        address: vault,
        abi: vaultAbi,
        functionName: 'createBounty',
        args: [targetId, slots],
        value: amount,
      })
    },
    [tx.send],
  )

  /** The payout of a bounty. The contract decides whether it may be settled. */
  const settleBounty = useCallback(
    async (account: Address, id: bigint): Promise<void> => {
      const vault = vaultAddress()
      if (vault === null) {
        setRefusal(copy.bounty.vaultMissing)
        return
      }
      setRefusal(null)
      await tx.send({
        account,
        address: vault,
        abi: vaultAbi,
        functionName: 'settleBounty',
        args: [id],
      })
    },
    [tx.send],
  )

  const reset = useCallback(() => {
    setRefusal(null)
    tx.reset()
  }, [tx.reset])

  return {
    status: (refusal === null ? tx.state : 'failed') as BountyStatus,
    error: refusal ?? tx.error,
    txHash: tx.txHash,
    createBounty,
    settleBounty,
    reset,
  }
}
