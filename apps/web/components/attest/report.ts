import type { Address, Hex } from 'viem'
import type { useSignTypedData, useWriteContract } from 'wagmi'
import { toHex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import {
  API_EIP712,
  EVIDENCE_MAX_BYTES,
  EvidenceReport,
  evidenceHashOf,
  parseShortProof,
  utf8Length,
} from '@sealflare/shared/schemas'
import { isValidFlags, targetIdOfContract, targetIdOfSkill, type TargetType, type Verdict } from '@sealflare/shared/rules'
import { ApiError, api } from '../../lib/api/client'
import { addresses } from '../../lib/chain/addresses'
import { expectedChainId } from '../../lib/chain/config'
import { isUserRejection, translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'
import { isBytes32, isContractWord } from '../../lib/targetWord'
import { shortProofOf, statementOf, travellingScan, trimScan } from './choice'
import type { AttestInput, AttestState, AttestTarget, Step } from './attest'

export type SignTypedDataAsync = ReturnType<typeof useSignTypedData>['signTypedDataAsync']
export type WriteContractAsync = ReturnType<typeof useWriteContract>['writeContractAsync']

const TARGET_TYPE_NUMBER: Record<TargetType, number> = { SMART_CONTRACT: 0, AI_SKILL_BUNDLE: 1 }
const VERDICT_NUMBER: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 }

/** A signed request may live five minutes. The server refuses anything longer. */
export const EXPIRY_SECONDS = 300

/** The address of the registry, or null when the deployment does not name one. */
export function coreAddress(): Address | null {
  try {
    return addresses(expectedChainId).core
  } catch {
    return null
  }
}

/** A nonce that is never used twice, as a decimal string the server reads. */
export function freshNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`).toString()
}

/**
 * The word the registry takes.
 *
 * A contract is named by its address, a skill by the canonical hash of its bundle. The id of a
 * target is the hash of that word, so the id is never the word itself. The vote is permanent, so
 * a word that does not hash to the id of this page is refused before anything is signed.
 */
export function wordOf(target: AttestTarget): Hex | null {
  const word = target.targetWord
  if (word === null) return null
  const fits = target.targetType === 'SMART_CONTRACT' ? isContractWord(word) : isBytes32(word)
  if (!fits) return null
  const id =
    target.targetType === 'SMART_CONTRACT' ? targetIdOfContract(`0x${word.slice(26)}`) : targetIdOfSkill(word as Hex)
  return id.toLowerCase() === target.targetId.toLowerCase() ? (word as Hex) : null
}

/**
 * The report that is signed, uploaded and hashed.
 *
 * The scan is only attached when the flags of the report hold every flag the scan found, because
 * a report may not leave out something the attached scan found. A Safe vote carries no flags, so
 * it carries no scan either.
 */
export function buildReport(target: AttestTarget, input: AttestInput, trim = false): EvidenceReport {
  const author = target.address
  if (author === null) throw new Error('The report needs the address of the Guardian.')
  const travelling = travellingScan({ verdict: input.verdict, flags: input.flags, quotes: input.quotes }, target.scan, target.targetId)
  const scan = travelling !== null && trim ? trimScan(travelling) : travelling
  const statement = statementOf(input.flags, input.quotes)
  const report = {
    schemaVersion: 1 as const,
    kind: 'attestation' as const,
    targetId: target.targetId as Hex,
    author,
    createdAt: new Date().toISOString(),
    flags: input.flags,
    shortProof: shortProofOf(input.flags, input.quotes, scan),
    ...(statement === undefined ? {} : { statement }),
  }
  return scan === null ? report : { ...report, scan }
}

/** The report, checked against the shared schema. Null when the schema or the summary refuses it. */
function parseReport(target: AttestTarget, input: AttestInput, trim: boolean): EvidenceReport | null {
  let parsed: ReturnType<typeof EvidenceReport.safeParse>
  try {
    parsed = EvidenceReport.safeParse(buildReport(target, input, trim))
  } catch {
    return null
  }
  if (!parsed.success) return null
  // A line of the evidence summary without a quote is no evidence at all.
  if (parseShortProof(parsed.data.shortProof).some(item => item.excerpt.trim() === '')) return null
  return parsed.data
}

/** Everything the two approvals need, built before the wallet is asked for anything. */
export type Prepared = {
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
  const parsed = parseReport(target, input, false)
  if (parsed === null) return null
  let reportJson = JSON.stringify(parsed)
  // The server refuses a report over the limit after the Guardian has signed it, and every retry
  // fails the same way. A scan with a finding for every match is trimmed to one per flag first.
  let report = parsed
  if (utf8Length(reportJson) > EVIDENCE_MAX_BYTES) {
    const trimmed = parseReport(target, input, true)
    if (trimmed === null) return null
    report = trimmed
    reportJson = JSON.stringify(trimmed)
    if (utf8Length(reportJson) > EVIDENCE_MAX_BYTES) return null
  }
  return {
    core,
    reportJson,
    evidenceHash: evidenceHashOf(new TextEncoder().encode(reportJson)),
    nonce: freshNonce(),
    expiry: String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
    shortProof: report.shortProof,
  }
}

/** Why the vote may not be written, or null when it may be written. */
export function blockerOf(target: AttestTarget, input: AttestInput, core: Address | null): string | null {
  if (target.address === null) return copy.wallet.agentRequired
  if (core === null) return copy.attest.noRegistry
  if (target.tier === 'STALE_CODEHASH_DRIFT') return copy.errors.CodeChangedSincePin
  if (wordOf(target) === null) return copy.attest.targetUnknown
  if (!isValidFlags(target.targetType, input.verdict, input.flags)) return copy.attest.invalidFlags
  return null
}

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
  /** Whether this attempt is still the one the panel shows. */
  isCurrent: () => boolean
}): Promise<Step<Hex>> {
  params.progress('signing-evidence')
  const signed = await approveEvidence(params.sign, params.prepared, params.target.address as Address)
  if (!signed.ok) return signed
  // The attempt was abandoned while the wallet was asking. Nothing is uploaded and no transaction
  // is asked for, because a vote the panel no longer shows can never be registered.
  if (!params.isCurrent()) return { ok: false, state: 'idle' }

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
  // The attempt was abandoned while the report was uploaded. The evidence is on the server, but
  // no transaction is asked for, because the vote it belongs to is not the one on the screen.
  if (!params.isCurrent()) return { ok: false, state: 'idle' }

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

export type Outcome = { state: 'idle' } | { state: 'failed'; message: string } | { state: 'pending'; hash: Hex }

export type Wallet = {
  sign: SignTypedDataAsync
  write: WriteContractAsync
  progress: (state: AttestState) => void
  /**
   * Whether this attempt is still the one the panel shows.
   *
   * An attempt that was abandoned never uploads its report and never asks for the transaction, so
   * a wallet prompt that answers late cannot cast a vote that is not registered.
   */
  isCurrent: () => boolean
}

/** Runs one attempt, from the checks to the transaction, and says where it ended. */
export async function attempt(target: AttestTarget, input: AttestInput, wallet: Wallet): Promise<Outcome> {
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
