'use client'
import { useCallback, useState } from 'react'
import { useSignTypedData, useWriteContract } from 'wagmi'
import { toHex, type Address, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { API_EIP712 } from '@sealflare/shared/schemas'
import { type TargetType, type Verdict } from '@sealflare/shared/rules'
import { ApiError, api } from '../../lib/api/client'
import { expectedChainId } from '../../lib/chain/config'
import { coreAddress } from '../../lib/chain/court'
import { isUserRejection, translateContractError } from '../../lib/chain/errors'
import { useReceipt } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { useCancel, type Cancelled } from './cancel'
import { blockerOf, prepare, wordOf, type AttestInput, type AttestTarget, type Prepared } from './report'

/** The states of an attestation, from the summary to the vote on the chain. */
export type AttestState = 'idle' | 'signing-evidence' | 'uploading' | 'signing-tx' | 'pending' | 'failed' | 'done'

/** The wallet or the chain is still working on the vote, so the panel cannot be left. */
export function isWorking(state: AttestState): boolean {
  return state === 'signing-evidence' || state === 'uploading' || state === 'signing-tx' || state === 'pending'
}

/**
 * The panel is locked while the work may not be left behind.
 *
 * While the evidence is signed, the user may leave: the attempt stops before the evidence is
 * pinned and before the transaction is sent, so a prompt that never settles cannot keep the panel
 * on the screen for ever. From the moment the transaction is asked for, the hash may arrive at any
 * time, so the panel stays until the receipt is read and the hash is tracked.
 */
export function isLocked(state: AttestState): boolean {
  return state === 'uploading' || state === 'signing-tx' || state === 'pending'
}

export type SignTypedDataAsync = ReturnType<typeof useSignTypedData>['signTypedDataAsync']
export type WriteContractAsync = ReturnType<typeof useWriteContract>['writeContractAsync']

const TARGET_TYPE_NUMBER: Record<TargetType, number> = { SMART_CONTRACT: 0, AI_SKILL_BUNDLE: 1 }
const VERDICT_NUMBER: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 }

/** The outcome of one step. A refusal in the wallet returns to the summary without an error. */
export type Step<T> = { ok: true; value: T } | { ok: false; state: 'idle' | 'failed'; message?: string }

/** The first approval: the signature of the evidence, without gas. */
export async function approveEvidence(
  sign: SignTypedDataAsync,
  prepared: Pick<Prepared, 'evidenceHash' | 'nonce' | 'expiry'>,
  account: Address,
): Promise<Step<Hex>> {
  try {
    // The account is named, so a wallet that switched account between the two approvals refuses
    // instead of signing as another Guardian.
    const signature = await sign({
      account,
      domain: { ...API_EIP712.domain, chainId: expectedChainId },
      types: { EvidenceUpload: [...API_EIP712.types.EvidenceUpload] },
      primaryType: 'EvidenceUpload',
      message: {
        evidenceHash: prepared.evidenceHash,
        nonce: BigInt(prepared.nonce),
        expiry: BigInt(prepared.expiry),
      },
    })
    return { ok: true, value: signature }
  } catch (failure) {
    if (isUserRejection(failure)) return { ok: false, state: 'idle' }
    return { ok: false, state: 'failed', message: copy.errors.unknown }
  }
}

/** The message a failed upload shows. A rate limit and a wrong hash say so. */
function uploadMessage(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'RATE_LIMITED') return copy.attest.rateLimited
  if (failure instanceof ApiError && failure.code === 'HASH_MISMATCH') return copy.attest.hashMismatch
  return copy.attest.uploadFailed
}

/** The upload of the report. The answer must name the same hash that was signed. */
async function uploadReport(
  body: { reportJson: string; address: string; nonce: string; expiry: string; signature: string },
  evidenceHash: Hex,
): Promise<string> {
  const answer = await api.uploadEvidence(body)
  if (answer.evidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
    throw new ApiError('HASH_MISMATCH', copy.attest.hashMismatch)
  }
  return answer.evidenceURI
}

/** The upload of the report. Nothing was pinned when it fails, so no transaction follows. */
export async function approveEvidenceUpload(
  body: { reportJson: string; address: string; nonce: string; expiry: string; signature: string },
  evidenceHash: Hex,
): Promise<Step<string>> {
  try {
    return { ok: true, value: await uploadReport(body, evidenceHash) }
  } catch (failure) {
    return { ok: false, state: 'failed', message: uploadMessage(failure) }
  }
}

/** The second approval: the attestation on the chain. */
async function approveTransaction(
  write: WriteContractAsync,
  params: {
    account: Address
    core: Address
    word: Hex
    targetType: TargetType
    verdict: Verdict
    flags: number
    evidenceHash: Hex
    shortProof: string
    evidenceURI: string
  },
): Promise<Step<Hex>> {
  try {
    // The account and the chain are named: the evidence was signed by this account, and `core` is
    // only valid on this chain, so a wallet that switched either refuses instead of sending.
    const hash = await write({
      account: params.account,
      chainId: expectedChainId,
      address: params.core,
      abi: coreAbi,
      functionName: 'attest',
      args: [
        TARGET_TYPE_NUMBER[params.targetType],
        params.word,
        VERDICT_NUMBER[params.verdict],
        params.flags,
        params.evidenceHash,
        toHex(new TextEncoder().encode(params.shortProof)),
        params.evidenceURI,
      ],
    })
    return { ok: true, value: hash }
  } catch (failure) {
    if (isUserRejection(failure)) return { ok: false, state: 'idle' }
    const translated = translateContractError(failure)
    return { ok: false, state: 'failed', message: translated?.message ?? copy.errors.unknown }
  }
}

/**
 * The two approvals and the upload between them.
 *
 * The order never changes: the report is signed first, then uploaded, and only then is the
 * transaction asked for. A refusal in the wallet is not a failure the user has to read about.
 */
async function runAttestation(params: {
  target: AttestTarget
  input: AttestInput
  prepared: Prepared
  sign: SignTypedDataAsync
  write: WriteContractAsync
  progress: (state: AttestState) => void
  cancelled: Cancelled
}): Promise<Step<Hex>> {
  params.progress('signing-evidence')
  const signed = await approveEvidence(params.sign, params.prepared, params.target.address as Address)
  if (!signed.ok) return signed
  // The panel was left while the wallet was asking: the evidence is not pinned and no transaction
  // is sent.
  if (params.cancelled.current) return { ok: false, state: 'idle' }

  params.progress('uploading')
  const uploaded = await approveEvidenceUpload(
    {
      reportJson: params.prepared.reportJson,
      address: params.target.address ?? '',
      nonce: params.prepared.nonce,
      expiry: params.prepared.expiry,
      signature: signed.value,
    },
    params.prepared.evidenceHash,
  )
  if (!uploaded.ok) return uploaded
  // The panel was left while the evidence was pinned: no transaction with a stake is sent.
  if (params.cancelled.current) return { ok: false, state: 'idle' }

  params.progress('signing-tx')
  return approveTransaction(params.write, {
    account: params.target.address as Address,
    core: params.prepared.core,
    word: wordOf(params.target) as Hex,
    targetType: params.target.targetType,
    verdict: params.input.verdict,
    flags: params.input.flags,
    evidenceHash: params.prepared.evidenceHash,
    shortProof: params.prepared.shortProof,
    evidenceURI: uploaded.value,
  })
}

type Outcome = { state: 'idle' } | { state: 'failed'; message: string } | { state: 'pending'; hash: Hex }

type Wallet = {
  sign: SignTypedDataAsync
  write: WriteContractAsync
  progress: (state: AttestState) => void
  cancelled: Cancelled
}

/** Runs one attempt, from the checks to the transaction, and says where it ended. */
async function attempt(target: AttestTarget, input: AttestInput, wallet: Wallet): Promise<Outcome> {
  const core = coreAddress()
  const blocker = blockerOf(target, input, core)
  if (blocker !== null) return { state: 'failed', message: blocker }
  const prepared = prepare(target, input, core as Address)
  if (prepared === null) return { state: 'failed', message: copy.attest.reportInvalid }
  const result = await runAttestation({ target, input, prepared, ...wallet })
  if (result.ok) return { state: 'pending', hash: result.value }
  if (result.state === 'idle') return { state: 'idle' }
  return { state: 'failed', message: result.message ?? copy.errors.unknown }
}

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
  const { cancelled, cancel, resume } = useCancel()
  const fail = useCallback((message: string) => {
    setState('failed')
    setError(message)
  }, [])
  // A speed-up is mined under another hash, so the vote is registered under the mined one.
  const done = useCallback((mined: Hex | null) => {
    if (mined !== null) setTxHash(mined)
    setState('done')
  }, [])
  useReceipt(state, txHash, done, fail)

  const submit = async (input: AttestInput) => {
    setError(null)
    setVerdict(input.verdict)
    resume()
    const outcome = await attempt(target, input, {
      sign: signTypedDataAsync,
      write: writeContractAsync,
      progress: setState,
      cancelled,
    })
    if (outcome.state === 'failed') return fail(outcome.message)
    if (outcome.state === 'pending') setTxHash(outcome.hash)
    setState(outcome.state)
  }

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
    setVerdict(null)
  }, [])

  return { state, error, txHash, verdict, submit, reset, cancel }
}
