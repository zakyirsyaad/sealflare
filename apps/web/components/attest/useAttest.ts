'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSignTypedData, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { toHex, type Address, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { API_EIP712, evidenceHashOf, type EvidenceReport, type ScanReport } from '@sealflare/shared/schemas'
import type { TargetType, Verdict } from '@sealflare/shared/rules'
import { api } from '../../lib/api/client'
import { addresses } from '../../lib/chain/addresses'
import { expectedChainId } from '../../lib/chain/config'
import { isUserRejection, translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'

/** The states of an attestation, from the summary to the vote on the chain. */
export type AttestState = 'idle' | 'signing-evidence' | 'uploading' | 'signing-tx' | 'pending' | 'failed' | 'done'

export type AttestInput = {
  verdict: Verdict
  flags: number
  shortProof: string
  statement?: string
}

export type AttestTarget = {
  targetId: string
  targetType: TargetType
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  /** The address that votes. Null when no wallet is connected. */
  address: Address | null
}

const TARGET_TYPE_NUMBER: Record<TargetType, number> = { SMART_CONTRACT: 0, AI_SKILL_BUNDLE: 1 }
const VERDICT_NUMBER: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 }

/** A signed request may live five minutes. The server refuses anything longer. */
const EXPIRY_SECONDS = 300

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
 * The report that is signed, uploaded and hashed.
 *
 * The scan is only attached when the flags of the report hold every flag the scan found, because
 * a report may not leave out something the attached scan found. A Safe vote carries no flags, so
 * it carries no scan either.
 */
export function buildReport(target: AttestTarget, input: AttestInput): EvidenceReport {
  const report: EvidenceReport = {
    schemaVersion: 1,
    kind: 'attestation',
    targetId: target.targetId as Hex,
    author: target.address ?? (`0x${'00'.repeat(20)}` as Address),
    createdAt: new Date().toISOString(),
    flags: input.flags,
    shortProof: input.shortProof,
    ...(input.statement === undefined ? {} : { statement: input.statement }),
  }
  const scan = target.scan
  const holds = scan !== null && (report.flags & scan.flags) === scan.flags
  return holds && scan !== null ? { ...report, scan } : report
}

/**
 * The attestation of one target.
 *
 * The order never changes: the report is built, hashed and signed first, then uploaded, and only
 * then is the transaction asked for. A refusal in the wallet is not a failure the user has to
 * read about, so it returns to the summary without an error.
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

  const submit = useCallback(
    async (input: AttestInput) => {
      if (target.address === null) {
        fail(copy.wallet.agentRequired)
        return
      }
      const core = coreAddress()
      if (core === null) {
        fail(copy.attest.noRegistry)
        return
      }
      const report = buildReport(target, input)
      const reportJson = JSON.stringify(report)
      const bytes = new TextEncoder().encode(reportJson)
      const evidenceHash = evidenceHashOf(bytes)
      const nonce = freshNonce()
      const expiry = String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS)
      setVerdict(input.verdict)
      setError(null)
      setState('signing-evidence')

      let signature: Hex
      try {
        signature = await signTypedDataAsync({
          domain: { ...API_EIP712.domain, chainId: expectedChainId },
          types: { EvidenceUpload: [...API_EIP712.types.EvidenceUpload] },
          primaryType: 'EvidenceUpload',
          message: { evidenceHash, nonce: BigInt(nonce), expiry: BigInt(expiry) },
        })
      } catch (failure) {
        // A refusal in the wallet returns to the summary. It is not a failure to read about.
        if (isUserRejection(failure)) {
          setState('idle')
          return
        }
        fail(copy.errors.unknown)
        return
      }

      setState('uploading')
      let evidenceURI: string
      try {
        const answer = await api.uploadEvidence({
          reportJson,
          address: target.address,
          nonce,
          expiry,
          signature,
        })
        evidenceURI = answer.evidenceURI
      } catch {
        // Nothing was pinned, so no transaction is asked for.
        fail(copy.attest.uploadFailed)
        return
      }

      setState('signing-tx')
      try {
        const hash = await writeContractAsync({
          address: core,
          abi: coreAbi,
          functionName: 'attest',
          args: [
            TARGET_TYPE_NUMBER[target.targetType],
            target.targetId as Hex,
            VERDICT_NUMBER[input.verdict],
            input.flags,
            evidenceHash,
            toHex(new TextEncoder().encode(input.shortProof)),
            evidenceURI,
          ],
        })
        setTxHash(hash)
        setState('pending')
      } catch (failure) {
        if (isUserRejection(failure)) {
          setState('idle')
          return
        }
        const translated = translateContractError(failure)
        fail(translated?.message ?? copy.errors.unknown)
      }
    },
    [target, signTypedDataAsync, writeContractAsync, fail],
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { state, error, txHash, verdict, submit, reset }
}
