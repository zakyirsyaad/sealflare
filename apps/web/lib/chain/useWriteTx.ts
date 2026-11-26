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

/** What the wallet did to a transaction that was on its way. */
export type Replacement = 'cancelled' | 'replaced' | 'repriced'

/** A replacement, and the transaction it was reported for. */
type ReplacementReport = { hash: string; reason: Replacement }

/**
 * Follows the receipt of a sent transaction.
 *
 * The chain is named, so a wallet that switched network after the signature cannot make the wait
 * read another chain. A transaction the wallet cancelled or replaced is a failure, and so is a
 * receipt of a transaction that is not the one that was sent. The hash of the mined receipt is
 * handed back, because a speed-up is mined under another hash than the one that was sent.
 */
export function useReceiptOutcome(
  state: string,
  txHash: Hex | null,
  settle: (state: 'done' | 'failed', error: string | null, mined: Hex | null) => void,
) {
  // The replacement belongs to the transaction it was reported for, so a retry starts clean.
  const [replacement, setReplacement] = useState<ReplacementReport | null>(null)
  const onReplaced = useCallback(
    (response: { reason: Replacement; replacedTransaction: { hash: string } }) => {
      // The chain names the transaction the replacement was reported for, so a report from an
      // older wait never lands on the transaction that is watched now.
      setReplacement({ hash: response.replacedTransaction.hash.toLowerCase(), reason: response.reason })
    },
    [],
  )
  const receipt = useWaitForTransactionReceipt({ hash: txHash ?? undefined, chainId: expectedChainId, onReplaced })
  useEffect(() => {
    if (state !== 'pending') return
    // A replacement of another transaction says nothing about this one.
    const reason = replacement !== null && replacement.hash === txHash?.toLowerCase() ? replacement.reason : null
    // A transaction the wallet cancelled or replaced never became the one that was sent.
    if (reason !== null && reason !== 'repriced') {
      settle('failed', copy.errors.txReplaced, null)
      return
    }
    if (receipt.isSuccess) {
      const mined = receipt.data?.transactionHash
      // A transaction that was mined and reverted still resolves the wait, so its status is read.
      if (receipt.data?.status === 'reverted') {
        settle('failed', copy.errors.unknown, null)
        return
      }
      // A receipt of another transaction is not the one that was sent. A repriced transaction is
      // the same intent with another hash, so it is not a failure.
      if (mined !== undefined && txHash !== null && mined.toLowerCase() !== txHash.toLowerCase() && reason !== 'repriced') {
        settle('failed', copy.errors.txReplaced, null)
        return
      }
      settle('done', null, mined ?? txHash)
      return
    }
    if (receipt.isError) settle('failed', translateContractError(receipt.error)?.message ?? copy.errors.unknown, null)
  }, [
    state,
    replacement,
    receipt.isSuccess,
    receipt.data?.status,
    receipt.data?.transactionHash,
    receipt.isError,
    receipt.error,
    settle,
    txHash,
  ])
}

/** Watches the receipt of a sent transaction and says where it ended. */
export function useReceipt(
  state: string,
  txHash: Hex | null,
  done: (mined: Hex | null) => void,
  fail: (message: string) => void,
) {
  const settle = useCallback(
    (next: 'done' | 'failed', message: string | null, mined: Hex | null) => {
      if (next === 'done') done(mined)
      else fail(message ?? copy.errors.unknown)
    },
    [done, fail],
  )
  useReceiptOutcome(state, txHash, settle)
}

/** One transaction from the user's wallet, with the four states of ux.md Section 5. */
export function useWriteTx() {
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<TxState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const settle = useCallback((next: 'done' | 'failed', message: string | null, mined: Hex | null) => {
    setState(next)
    setError(message)
    // A speed-up is mined under another hash, so the link must name the transaction that was mined.
    if (mined !== null) setTxHash(mined)
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
        settle('failed', step.message, null)
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
