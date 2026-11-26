'use client'
import { useCallback, useEffect, useState } from 'react'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import type { Abi, Address, Hex } from 'viem'
import { expectedChainId } from './config'
import { isUserRejection, translateContractError } from './errors'
import { copy } from '../copy'

/** The states of one transaction. A refusal in the wallet returns to idle without an error. */
export type TxState = 'idle' | 'signing' | 'pending' | 'failed' | 'done'

export type TxRequest = {
  account: Address
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
  value?: bigint
}

type WriteContractAsync = ReturnType<typeof useWriteContract>['writeContractAsync']

/** What one write came to. A refusal in the wallet is not a failure the user has to read about. */
export type WriteStep = { ok: true; hash: Hex } | { ok: false; rejected: true } | { ok: false; rejected: false; message: string }

/**
 * Asks the wallet for one transaction.
 *
 * The account and the chain are named, so a wallet that switched either one refuses instead of
 * sending as another account. A revert names its own reason.
 */
export async function writeStep(write: WriteContractAsync, request: TxRequest): Promise<WriteStep> {
  try {
    const hash = await write({
      account: request.account,
      chainId: expectedChainId,
      address: request.address,
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
      ...(request.value === undefined ? {} : { value: request.value }),
    } as Parameters<WriteContractAsync>[0])
    return { ok: true, hash }
  } catch (failure) {
    if (isUserRejection(failure)) return { ok: false, rejected: true }
    return { ok: false, rejected: false, message: translateContractError(failure)?.message ?? copy.errors.unknown }
  }
}

/** The wallet or the chain is still working, so the control cannot be used again. */
export function isTxWorking(state: TxState): boolean {
  return state === 'signing' || state === 'pending'
}

/** Follows the receipt of a sent transaction. A mined transaction that reverted is a failure. */
function useReceiptOutcome(
  state: TxState,
  txHash: Hex | null,
  settle: (state: 'done' | 'failed', error: string | null) => void,
) {
  const receipt = useWaitForTransactionReceipt({ hash: txHash ?? undefined })
  useEffect(() => {
    if (state !== 'pending') return
    if (receipt.isSuccess) {
      // A transaction that was mined and reverted still resolves the wait, so its status is read.
      if (receipt.data?.status === 'reverted') settle('failed', copy.errors.unknown)
      else settle('done', null)
      return
    }
    if (receipt.isError) settle('failed', translateContractError(receipt.error)?.message ?? copy.errors.unknown)
  }, [state, receipt.isSuccess, receipt.data?.status, receipt.isError, receipt.error, settle])
}

/** One transaction from the user's wallet, with the four states of ux.md Section 5. */
export function useWriteTx() {
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<TxState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const settle = useCallback((next: 'done' | 'failed', message: string | null) => {
    setState(next)
    setError(message)
  }, [])
  useReceiptOutcome(state, txHash, settle)

  const send = useCallback(
    async (request: TxRequest) => {
      setError(null)
      setState('signing')
      const step = await writeStep(writeContractAsync, request)
      if (step.ok) {
        setTxHash(step.hash)
        setState('pending')
      } else if (step.rejected) {
        setState('idle')
      } else {
        settle('failed', step.message)
      }
    },
    [writeContractAsync, settle],
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { state, error, txHash, send, reset }
}
