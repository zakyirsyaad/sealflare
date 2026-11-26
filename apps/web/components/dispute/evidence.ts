import type { Address, Hex } from 'viem'
import {
  EVIDENCE_MAX_BYTES,
  EvidenceReport,
  STATEMENT_MAX_CHARS,
  evidenceHashOf,
  parseShortProof,
  utf8Length,
  type ScanReport,
} from '@sealflare/shared/schemas'
import { EXPIRY_SECONDS, freshNonce } from '../attest/report'
import { shortProofOf, travellingScan, trimScan } from '../attest/choice'

/** Everything the two approvals need, built before the wallet is asked for anything. */
export type PreparedEvidence = {
  reportJson: string
  evidenceHash: Hex
  nonce: string
  expiry: string
  /** The summary written on-chain. Empty for a reply, which has none. */
  shortProof: string
}

type ChallengeInput = {
  targetId: string
  author: Address
  flags: number
  quotes: Record<string, string>
  statement: string
  scan: ScanReport | null
}

/**
 * The report of a challenge.
 *
 * The scan only travels with it when it is the scan of this very target and the flags still hold
 * every flag the scan found, because a report may not leave out something its scan found.
 */
export function buildChallengeReport(input: ChallengeInput, trim = false): EvidenceReport {
  const travelling = travellingScan({ verdict: 'DANGER', flags: input.flags, quotes: input.quotes }, input.scan, input.targetId)
  const scan = travelling !== null && trim ? trimScan(travelling) : travelling
  const statement = input.statement.trim().slice(0, STATEMENT_MAX_CHARS)
  return {
    schemaVersion: 1,
    kind: 'challenge',
    targetId: input.targetId as Hex,
    author: input.author,
    createdAt: new Date().toISOString(),
    flags: input.flags,
    shortProof: shortProofOf(input.flags, input.quotes, scan),
    ...(statement === '' ? {} : { statement }),
    ...(scan === null ? {} : { scan }),
  }
}

/** The reply of a publisher: a statement, with no flags and no on-chain summary. */
export function buildReplyReport(input: { targetId: string; author: Address; statement: string }): EvidenceReport {
  return {
    schemaVersion: 1,
    kind: 'counter',
    targetId: input.targetId as Hex,
    author: input.author,
    createdAt: new Date().toISOString(),
    flags: 0,
    shortProof: '',
    statement: input.statement.trim().slice(0, STATEMENT_MAX_CHARS),
  }
}

/** The report, checked against the shared schema. Null when the schema or the summary refuses it. */
function checked(report: EvidenceReport): EvidenceReport | null {
  const parsed = EvidenceReport.safeParse(report)
  if (!parsed.success) return null
  // A line of the evidence summary without a quote is no evidence at all.
  if (parseShortProof(parsed.data.shortProof).some(item => item.excerpt.trim() === '')) return null
  return parsed.data
}

/**
 * The signed document, hashed and ready for the wallet.
 *
 * The report is checked before it is signed, so a report the server would refuse never asks for a
 * signature. A scan with a finding for every match is trimmed to one per flag when it is too long,
 * because the server refuses an oversized report after the signature and every retry fails alike.
 */
export function prepareEvidence(build: (trim: boolean) => EvidenceReport): PreparedEvidence | null {
  for (const trim of [false, true]) {
    const report = checked(build(trim))
    if (report === null) return null
    const reportJson = JSON.stringify(report)
    if (utf8Length(reportJson) > EVIDENCE_MAX_BYTES) continue
    return {
      reportJson,
      evidenceHash: evidenceHashOf(new TextEncoder().encode(reportJson)),
      nonce: freshNonce(),
      expiry: String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
      shortProof: report.shortProof,
    }
  }
  return null
}
