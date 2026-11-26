'use client'
import { useCallback, useRef, useState } from 'react'
import { useSignTypedData, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import type { Verdict } from '@sealflare/shared/rules'
import type { AttestInput, AttestState, AttestTarget } from './attest'
import { attempt } from './report'
import { useReceipt } from './receipt'

export { isWorking, type AttestInput, type AttestState, type AttestTarget } from './attest'

/**
 * The attestation of one target.
 *
 * The order never changes: the report is built, validated, hashed and signed first, then
 * uploaded, and only then is the transaction asked for. A refusal in the wallet is not a failure
 * the user has to read about, so it returns to the summary without an error.
 */
export function useAttest(target: AttestTarget) {
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<AttestState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  // The verdict that was sent, because the choice on the screen may change after the vote.
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  // The account that cast it, because the wallet may switch to another account afterwards.
  const [account, setAccount] = useState<Address | null>(null)
  // Which attempt is the current one. An attempt that was abandoned never changes the state again,
  // so a wallet prompt that answers after the dialog was closed is ignored.
  const run = useRef(0)
  const fail = useCallback((message: string) => {
    setState('failed')
    setError(message)
  }, [])
  const done = useCallback((hash: Hex) => {
    // The hash of the receipt is the transaction that landed. A speed-up replaced the one that was
    // sent, so the old hash names a transaction that never landed.
    setTxHash(hash)
    setState('done')
  }, [])
  useReceipt(state, txHash, done, fail)

  const submit = async (input: AttestInput) => {
    const id = run.current + 1
    run.current = id
    setError(null)
    setVerdict(input.verdict)
    setAccount(target.address)
    const outcome = await attempt(target, input, {
      sign: signTypedDataAsync,
      write: writeContractAsync,
      // A step of an attempt that was abandoned says nothing any more.
      progress: next => {
        if (run.current === id) setState(next)
      },
      // An attempt that was abandoned stops here: it uploads nothing and asks the wallet for no
      // transaction, so a prompt that answers late cannot cast a vote the panel no longer shows.
      isCurrent: () => run.current === id,
    })
    // The attempt was abandoned while the wallet was asking, so its answer is dropped.
    if (run.current !== id) return
    if (outcome.state === 'failed') return fail(outcome.message)
    if (outcome.state === 'pending') setTxHash(outcome.hash)
    setState(outcome.state)
  }

  const reset = useCallback(() => {
    // The attempt that was running is abandoned, and its late answer is ignored.
    run.current += 1
    setState('idle')
    setError(null)
    setTxHash(null)
    setVerdict(null)
    setAccount(null)
  }, [])

  return { state, error, txHash, verdict, account, submit, reset }
}
