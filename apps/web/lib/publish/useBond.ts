'use client'
import { useState } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { vaultAddress } from '../chain/addresses'
import { expectedChainId } from '../chain/config'
import { isUserRejection, translateContractError } from '../chain/errors'
import { copy } from '../copy'
import { confirmWrite, WriteFailed } from './confirm'

export type BondStatus = 'idle' | 'sending' | 'done' | 'failed'

export type BondState = { status: BondStatus; error: string | null; txHash: Hex | null }

/**
 * The bond writes. The bond is BNB that goes straight to the vault, so no token is ever approved,
 * and the wallet of the visitor signs and pays for every one of them.
 */
export function useBond() {
  const write = useWriteContract()
  const client = usePublicClient({ chainId: expectedChainId })
  const [state, setState] = useState<BondState>({ status: 'idle', error: null, txHash: null })

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

  /** The bond of the publisher of the target. */
  async function deposit(targetId: Hex, amount: bigint): Promise<boolean> {
    const vault = vaultAddress()
    if (vault === null) {
      setState({ status: 'failed', error: copy.publisher.vaultMissing, txHash: null })
      return false
    }
    return run(() =>
      write.mutateAsync({
        address: vault,
        abi: vaultAbi,
        functionName: 'depositBond',
        args: [targetId],
        value: amount,
        chainId: expectedChainId,
      }),
    )
  }

  /** The bond stops counting at once, but it stays slashable until it is finalized. */
  async function requestWithdrawal(targetId: Hex): Promise<boolean> {
    const vault = vaultAddress()
    if (vault === null) {
      setState({ status: 'failed', error: copy.publisher.vaultMissing, txHash: null })
      return false
    }
    return run(() =>
      write.mutateAsync({
        address: vault,
        abi: vaultAbi,
        functionName: 'requestBondWithdrawal',
        args: [targetId],
        chainId: expectedChainId,
      }),
    )
  }

  /** The bond returns to the balance of the depositor, after the waiting time has passed. */
  async function finalizeWithdrawal(targetId: Hex): Promise<boolean> {
    const vault = vaultAddress()
    if (vault === null) {
      setState({ status: 'failed', error: copy.publisher.vaultMissing, txHash: null })
      return false
    }
    return run(() =>
      write.mutateAsync({
        address: vault,
        abi: vaultAbi,
        functionName: 'finalizeBondWithdrawal',
        args: [targetId],
        chainId: expectedChainId,
      }),
    )
  }

  return { state, deposit, requestWithdrawal, finalizeWithdrawal, reset: () => setState({ status: 'idle', error: null, txHash: null }) }
}
