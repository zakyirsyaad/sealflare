'use client'
import { useCallback, useState } from 'react'
import { useSignTypedData, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { writeStep, type TxRequest } from '../../lib/chain/useWriteTx'
import {
  approveEvidence,
  approveEvidenceUpload,
  useReceipt,
  type AttestState,
  type Step,
} from '../attest/useAttest'
import type { PreparedEvidence } from './evidence'

type WriteContractAsync = ReturnType<typeof useWriteContract>['writeContractAsync']

/** What the transaction of the flow is, once the evidence is pinned and its URI is known. */
export type EvidenceTx = (evidenceURI: string) => TxRequest

/** The wallet is asked for the transaction, and a refusal there returns to the summary without an error. */
async function sendTx(write: WriteContractAsync, request: TxRequest): Promise<Step<Hex>> {
  const step = await writeStep(write, request)
  if (step.ok) return { ok: true, value: step.hash }
  if (step.rejected) return { ok: false, state: 'idle' }
  return { ok: false, state: 'failed', message: step.message }
}

/**
 * The two approvals of an action that carries evidence: sign the upload, pin the evidence, and
 * only then ask for the transaction. The order never changes, so a transaction is never asked
 * for before the evidence behind it is pinned.
 */
export function useEvidenceFlow() {
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const [state, setState] = useState<AttestState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const fail = useCallback((message: string) => {
    setState('failed')
    setError(message)
  }, [])
  const done = useCallback(() => setState('done'), [])
  useReceipt(state, txHash, done, fail)

  const run = async (params: { account: Address; prepared: PreparedEvidence; transaction: EvidenceTx }) => {
    const { account, prepared } = params
    setError(null)
    setState('signing-evidence')
    const signed = await approveEvidence(signTypedDataAsync, prepared, account)
    if (!signed.ok) return finish(signed)
    setState('uploading')
    const uploaded = await approveEvidenceUpload(
      {
        reportJson: prepared.reportJson,
        address: account,
        nonce: prepared.nonce,
        expiry: prepared.expiry,
        signature: signed.value,
      },
      prepared.evidenceHash,
    )
    if (!uploaded.ok) return finish(uploaded)
    setState('signing-tx')
    const sent = await sendTx(writeContractAsync, params.transaction(uploaded.value))
    if (sent.ok) setTxHash(sent.value)
    return finish(sent, 'pending')
  }

  /** Where one step ended. A refusal in the wallet is back to the summary, with no message. */
  const finish = (step: Step<unknown>, success: AttestState = 'idle') => {
    if (step.ok) return setState(success)
    if (step.state === 'idle') return setState('idle')
    fail(step.message ?? '')
  }

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { state, error, txHash, run, fail, reset }
}
