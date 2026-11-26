'use client'
import { useState } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import type { Hex } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { expectedChainId } from '../chain/config'
import { isUserRejection, translateContractError } from '../chain/errors'
import { copy } from '../copy'
import { confirmWrite, WriteFailed } from '../publish/confirm'
import { vaultAddress } from '../publish/useBond'

export type BountyStatus = 'idle' | 'sending' | 'done' | 'failed'

export type BountyWriteState = { status: BountyStatus; error: string | null; txHash: Hex | null }

/**
 * The writes of the bounties.
 *
 * A bounty is BNB that goes straight to the vault, so no token is ever approved. The wallet of
 * the visitor signs every write, and the server signs nothing.
 */
export function useBounty() {
  const write = useWriteContract()
  const client = usePublicClient({ chainId: expectedChainId })
  const [state, setState] = useState<BountyWriteState>({ status: 'idle', error: null, txHash: null })

  function fail(error: unknown): void {
    if (isUserRejection(error)) {
      setState({ status: 'idle', error: null, txHash: null })
      return
    }
    const translated = translateContractError(error)
    const message = error instanceof WriteFailed ? error.message : (translated?.message ?? copy.errors.unknown)
    setState({ status: 'failed', error: message, txHash: null })
  }

  /** The write is a success only when the chain has confirmed the receipt. */
  async function run(action: () => Promise<Hex>): Promise<boolean> {
    setState({ status: 'sending', error: null, txHash: null })
    try {
      const txHash = await action()
      await confirmWrite(client, txHash)
      setState({ status: 'done', error: null, txHash })
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  /** The bounty of one target, with the slots it offers and the money it holds. */
  async function createBounty(targetId: Hex, slots: number, amount: bigint): Promise<boolean> {
    const vault = vaultAddress()
    if (vault === null) {
      setState({ status: 'failed', error: copy.bounty.vaultMissing, txHash: null })
      return false
    }
    return run(() =>
      write.mutateAsync({
        address: vault,
        abi: vaultAbi,
        functionName: 'createBounty',
        args: [targetId, slots],
        value: amount,
        chainId: expectedChainId,
      }),
    )
  }

  /** The payout of a bounty. The contract decides whether it may be settled. */
  async function settleBounty(id: bigint): Promise<boolean> {
    const vault = vaultAddress()
    if (vault === null) {
      setState({ status: 'failed', error: copy.bounty.vaultMissing, txHash: null })
      return false
    }
    return run(() =>
      write.mutateAsync({
        address: vault,
        abi: vaultAbi,
        functionName: 'settleBounty',
        args: [id],
        chainId: expectedChainId,
      }),
    )
  }

  return {
    state,
    createBounty,
    settleBounty,
    reset: () => setState({ status: 'idle', error: null, txHash: null }),
  }
}
