import { type Hex, keccak256 } from 'viem'
import { z } from 'zod'
import { CONSTANTS, FLAGS } from '../rules'
import { AddressSchema, Bytes32Schema, FlagsSchema, IsoDateSchema, utf8Length } from './primitives'
import { SandboxResult } from './sandbox'
import { ScanReport } from './scan'

export const STATEMENT_MAX_CHARS = 4000

/** The JSON document stored on IPFS behind an attestation, a challenge or a publisher's reply. */
export const EvidenceReport = z
  .object({
  schemaVersion: z.literal(1),
  kind: z.enum(['attestation', 'challenge', 'counter']),
  targetId: Bytes32Schema,
  author: AddressSchema,
  createdAt: IsoDateSchema,
  flags: FlagsSchema,
  shortProof: z.string().refine((text) => utf8Length(text) <= CONSTANTS.SHORT_PROOF_MAX_BYTES, 'shortProof is longer than 512 bytes'),
  statement: z.string().max(STATEMENT_MAX_CHARS).optional(),
  scan: ScanReport.optional(),
  sandbox: SandboxResult.optional(),
  })
  .superRefine((report, ctx) => {
    const { scan, sandbox } = report
    if (scan && scan.targetId !== report.targetId) {
      ctx.addIssue({ code: 'custom', path: ['scan', 'targetId'], message: 'the attached scan is about another target' })
    }
    if (scan && (report.flags & scan.flags) !== scan.flags) {
      ctx.addIssue({ code: 'custom', path: ['flags'], message: 'flags leave out something the attached scan found' })
    }
    if (sandbox?.status === 'SANDBOX_FUZZ_FAILED' && (report.flags & FLAGS.SANDBOX_FUZZ_FAILED) === 0) {
      ctx.addIssue({ code: 'custom', path: ['flags'], message: 'a failed sandbox run must set SANDBOX_FUZZ_FAILED' })
    }
    if (scan?.source.kind === 'skill' && sandbox && sandbox.bundleHash !== scan.source.canonicalBundleHash) {
      ctx.addIssue({ code: 'custom', path: ['sandbox', 'bundleHash'], message: 'the sandbox run is about another bundle' })
    }
  })
export type EvidenceReport = z.infer<typeof EvidenceReport>

/**
 * The `evidenceHash` written on-chain: keccak256 of the exact bytes stored at `evidenceURI`.
 * Hash the bytes you upload, not a re-serialised copy.
 */
export function evidenceHashOf(bytes: Uint8Array): Hex {
  return keccak256(bytes)
}
