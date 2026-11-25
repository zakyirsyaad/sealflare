'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { toHex, type Address, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { API_EIP712, EvidenceReport, evidenceHashOf, type ScanReport } from '@sealflare/shared/schemas'
import type { TargetType, Verdict } from '@sealflare/shared/rules'
import { ApiError, api } from '../../lib/api/client'
import { addresses } from '../../lib/chain/addresses'
import { expectedChainId } from '../../lib/chain/config'
import { isUserRejection, translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'
import { shortProofOf } from './choice'

/** The states of an attestation, from the summary to the vote on the chain. */
export type AttestState = 'idle' | 'signing-evidence' | 'uploading' | 'signing-tx' | 'pending' | 'failed' | 'done'

export type AttestInput = {
  verdict: Verdict
  flags: number
  /** The quote the Guardian wrote for every flag the scanner did not find. */
  quotes: Record<string, string>
}

export type AttestTarget = {
  targetId: string
  targetType: TargetType
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  /** The address that votes. Null when no wallet is connected. */
  address: Address | null
}

type SignTypedDataAsync = ReturnType<typeof useSignTypedData>['signTypedDataAsync']
type WriteContractAsync = ReturnType<typeof useWriteContract>['writeContractAsync']

const TARGET_TYPE_NUMBER: Record<TargetType, number> = { SMART_CONTRACT: 0, AI_SKILL_BUNDLE: 1 }
const VERDICT_NUMBER: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 }

/** A signed request may live five minutes. The server refuses anything longer. */
const EXPIRY_SECONDS = 300

/** The outcome of one step. A refusal in the wallet returns to the summary without an error. */
type Step<T> = { ok: true; value: T } | { ok: false; state: 'idle' | 'failed'; message?: string }

/** The address of the registry, or null when the deployment does not name one. */
function coreAddress(): Address | null {
  try {
    return addresses(expectedChainId).core
  } catch {
    return null
  }
}

/** A nonce that is never used twice, as a decimal string the server reads. */
function freshNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`).toString()
}

/**
 * The scan that may travel with the report.
 *
 * The report may only carry a scan of its own target, and only when the report still holds every
 * flag the scan found. Otherwise the scan stays out, because a report that leaves out a finding
 * of its own scan is not a valid report.
 */
function attachedScan(target: AttestTarget, flags: number): ScanReport | null {
  const scan = target.scan
  if (scan === null) return null
  if (scan.targetId !== target.targetId) return null
  if ((flags & scan.flags) !== scan.flags) return null
  return scan
}

/**
 * The report that is signed, uploaded and hashed.
 *
 * The scan is only attached when the flags of the report hold every flag the scan found, because
 * a report may not leave out something the attached scan found. A Safe vote carries no flags, so
 * it carries no scan either.
 */
export function buildReport(target: AttestTarget, input: AttestInput): EvidenceReport {
  const author = target.address
  if (author === null) throw new Error('The report needs the address of the Guardian.')
  const scan = attachedScan(target, input.flags)
  const report = {
    schemaVersion: 1 as const,
    kind: 'attestation' as const,
    targetId: target.targetId as Hex,
    author,
    createdAt: new Date().toISOString(),
    flags: input.flags,
    shortProof: shortProofOf(input.flags, input.quotes, scan),
  }
  return scan === null ? report : { ...report, scan }
}

/** Everything the two approvals need, built before the wallet is asked for anything. */
type Prepared = {
  core: Address
  reportJson: string
  evidenceHash: Hex
  nonce: string
  expiry: string
  shortProof: string
}

/**
 * The report is checked before it is signed, so a report the server would refuse never asks the
 * Guardian for a signature.
 */
function prepare(target: AttestTarget, input: AttestInput, core: Address): Prepared | null {
  const parsed = EvidenceReport.safeParse(buildReport(target, input))
  if (!parsed.success) return null
  const reportJson = JSON.stringify(parsed.data)
  return {
    core,
    reportJson,
    evidenceHash: evidenceHashOf(new TextEncoder().encode(reportJson)),
    nonce: freshNonce(),
    expiry: String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
    shortProof: parsed.data.shortProof,
  }
}

/** The first approval: the signature of the evidence, without gas. */
async function approveEvidence(
  sign: SignTypedDataAsync,
  prepared: Prepared,
): Promise<Step<Hex>> {
  try {
    const signature = await sign({
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

/** The message a failed upload shows. A rate limit says so, anything else stays plain. */
function uploadMessage(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'RATE_LIMITED') return copy.attest.rateLimited
  return copy.attest.uploadFailed
}

/** The upload of the report. The answer must name the same hash that was signed. */
async function uploadReport(
  body: { reportJson: string; address: string; nonce: string; expiry: string; signature: string },
  evidenceHash: Hex,
): Promise<string> {
  const answer = await api.uploadEvidence(body)
  if (answer.evidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
    throw new ApiError('INTERNAL', copy.attest.uploadFailed)
  }
  return answer.evidenceURI
}

/** The upload of the report. Nothing was pinned when it fails, so no transaction follows. */
async function approveEvidenceUpload(
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
    core: Address
    targetId: string
    targetType: TargetType
    verdict: Verdict
    flags: number
    evidenceHash: Hex
    shortProof: string
    evidenceURI: string
  },
): Promise<Step<Hex>> {
  try {
    const hash = await write({
      address: params.core,
      abi: coreAbi,
      functionName: 'attest',
      args: [
        TARGET_TYPE_NUMBER[params.targetType],
        params.targetId as Hex,
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
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const receipt = useWaitForTransactionReceipt({ hash: txHash ?? undefined })

  const fail = useCallback((message: string) => {
    setState('failed')
    setError(message)
  }, [])

  // The receipt decides whether the vote landed. A reverted transaction names its own reason.
  useEffect(() => {
    if (state !== 'pending') return
    if (receipt.isSuccess) {
      setState('done')
      return
    }
    if (receipt.isError) {
      const translated = translateContractError(receipt.error)
      fail(translated?.message ?? copy.errors.unknown)
    }
  }, [state, receipt.isSuccess, receipt.isError, receipt.error, fail])

  const submit = async (input: AttestInput) => {
    if (target.address === null) {
      fail(copy.wallet.agentRequired)
      return
    }
    const core = coreAddress()
    if (core === null) {
      fail(copy.attest.noRegistry)
      return
    }
    const prepared = prepare(target, input, core)
    if (prepared === null) {
      fail(copy.attest.reportInvalid)
      return
    }
    setVerdict(input.verdict)
    setError(null)
    setState('signing-evidence')

    const signed = await approveEvidence(signTypedDataAsync, prepared)
    if (!signed.ok) {
      if (signed.state === 'idle') setState('idle')
      else fail(signed.message ?? copy.errors.unknown)
      return
    }

    setState('uploading')
    const uploaded = await approveEvidenceUpload(
      {
        reportJson: prepared.reportJson,
        address: target.address,
        nonce: prepared.nonce,
        expiry: prepared.expiry,
        signature: signed.value,
      },
      prepared.evidenceHash,
    )
    if (!uploaded.ok) {
      fail(uploaded.message ?? copy.attest.uploadFailed)
      return
    }

    setState('signing-tx')
    const sent = await approveTransaction(writeContractAsync, {
      core: prepared.core,
      targetId: target.targetId,
      targetType: target.targetType,
      verdict: input.verdict,
      flags: input.flags,
      evidenceHash: prepared.evidenceHash,
      shortProof: prepared.shortProof,
      evidenceURI: uploaded.value,
    })
    if (!sent.ok) {
      if (sent.state === 'idle') setState('idle')
      else fail(sent.message ?? copy.errors.unknown)
      return
    }
    setTxHash(sent.value)
    setState('pending')
  }

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { state, error, txHash, verdict, submit, reset }
}
