'use client'
import { useCallback, useState } from 'react'
import { useSignTypedData, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { useReceipt, writeStep, type TxRequest } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import {
  approveEvidence,
  approveEvidenceUpload,
  type AttestState,
  type SignTypedDataAsync,
  type WriteContractAsync,
  type Step,
} from '../attest/useAttest'
import { useCancel, type Cancelled } from '../attest/cancel'
import type { PreparedEvidence } from './evidence'

/** What the transaction of the flow is, once the evidence is pinned and its URI is known. */
export type EvidenceTx = (evidenceURI: string) => TxRequest

/** The wallet is asked for the transaction, and a refusal there returns to the summary without an error. */
async function sendTx(write: WriteContractAsync, request: TxRequest): Promise<Step<Hex>> {
  const step = await writeStep(write, request)
  if (step.ok) return { ok: true, value: step.hash }
  if (step.rejected) return { ok: false, state: 'idle' }
  return { ok: false, state: 'failed', message: step.message }
}

type RunParams = { account: Address; prepared: PreparedEvidence; transaction: EvidenceTx }

/**
 * Sign the upload, pin the evidence, and only then ask for the transaction. The order never
 * changes, so a transaction is never asked for before the evidence behind it is pinned.
 */
async function runSteps(
  params: RunParams,
  wallet: { sign: SignTypedDataAsync; write: WriteContractAsync },
  progress: (state: AttestState) => void,
  cancelled: Cancelled,
): Promise<Step<Hex>> {
  const { account, prepared } = params
  progress('signing-evidence')
  const signed = await approveEvidence(wallet.sign, prepared, account)
  if (!signed.ok) return signed
  // The panel was left while the wallet was asking: the evidence is not pinned and no
  // transaction is sent.
  if (cancelled.current) return { ok: false, state: 'idle' }
  progress('uploading')
  const uploaded = await approveEvidenceUpload(
    { reportJson: prepared.reportJson, address: account, nonce: prepared.nonce, expiry: prepared.expiry, signature: signed.value },
    prepared.evidenceHash,
  )
  if (!uploaded.ok) return uploaded
  // The panel was left while the evidence was pinned: no transaction with a stake is sent.
  if (cancelled.current) return { ok: false, state: 'idle' }
  progress('signing-tx')
  return sendTx(wallet.write, params.transaction(uploaded.value))
}

/** The two approvals of an action that carries evidence, and the receipt of the transaction after them. */
export function useEvidenceFlow() {
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<AttestState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const { cancelled, cancel, resume } = useCancel()
  const fail = useCallback((message: string) => {
    setState('failed')
    setError(message)
  }, [])
  // A speed-up is mined under another hash, so the link must name the transaction that was mined.
  const done = useCallback((mined: Hex | null) => {
    if (mined !== null) setTxHash(mined)
    setState('done')
  }, [])
  useReceipt(state, txHash, done, fail)

  const run = async (params: RunParams) => {
    setError(null)
    resume()
    const result = await runSteps(params, { sign: signTypedDataAsync, write: writeContractAsync }, setState, cancelled)
    if (result.ok) {
      setTxHash(result.value)
      setState('pending')
    } else if (result.state === 'idle') {
      // A refusal in the wallet is back to the summary, with no message.
      setState('idle')
    } else {
      fail(result.message ?? copy.errors.unknown)
    }
  }

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { state, error, txHash, run, fail, reset, cancel }
}
