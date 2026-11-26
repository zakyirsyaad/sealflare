import type { Address, Hex } from 'viem'
import { EVIDENCE_MAX_BYTES, EvidenceReport, evidenceHashOf, parseShortProof, utf8Length, type ScanReport } from '@sealflare/shared/schemas'
import { isValidFlags, targetIdOfContract, targetIdOfSkill, type TargetType, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { copy } from '../../lib/copy'
import { isBytes32, isContractWord } from '../../lib/targetWord'
import { shortProofOf, statementOf, travellingScan, trimScan } from './choice'

export type AttestInput = {
  verdict: Verdict
  flags: number
  /** The quote the Guardian wrote for every flag the scanner did not find. */
  quotes: Record<string, string>
}

export type AttestTarget = {
  targetId: string
  targetType: TargetType
  /** The word `Core.attest` takes. Null when the target is not known yet. */
  targetWord: string | null
  tier: TrustTier
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  /** The address that votes. Null when no wallet is connected. */
  address: Address | null
}

/** A signed request may live five minutes. The server refuses anything longer. */
export const EXPIRY_SECONDS = 300

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
export function prepare(target: AttestTarget, input: AttestInput, core: Address): Prepared | null {
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

/** Why the vote may not be written, or null when it may be written. */
export function blockerOf(target: AttestTarget, input: AttestInput, core: Address | null): string | null {
  if (target.address === null) return copy.wallet.agentRequired
  if (core === null) return copy.attest.noRegistry
  if (target.tier === 'STALE_CODEHASH_DRIFT') return copy.errors.CodeChangedSincePin
  if (wordOf(target) === null) return copy.attest.targetUnknown
  if (!isValidFlags(target.targetType, input.verdict, input.flags)) return copy.attest.invalidFlags
  return null
}
