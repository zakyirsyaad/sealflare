import { z } from 'zod'
import { CONSTANTS, CONTRACT_FLAGS_MASK, FLAGS, SKILL_FLAGS_MASK } from '../rules'
import {
  AddressSchema,
  Bytes32Schema,
  FlagNameSchema,
  FlagsSchema,
  IsoDateSchema,
  TargetTypeSchema,
  UintStringSchema,
  VerdictSchema,
  utf8Length,
} from './primitives'

export const CONTRACT_CHECK_IDS = [
  'source_verified',
  'admin_functions',
  'proxy_eip1967',
  'proxy_beacon',
  'proxy_eip1167',
  'delegatecall_opcode',
  'dry_run',
] as const
export const SKILL_CHECK_IDS = [
  'bundle_hash',
  'zero_width_unicode',
  'unlimited_approval',
  'hardcoded_transfer',
  'pipe_to_shell',
  'external_dependency',
  'helper_scripts',
] as const
export const CheckId = z.enum([...CONTRACT_CHECK_IDS, ...SKILL_CHECK_IDS])
export type CheckId = z.infer<typeof CheckId>

export const Check = z.object({
  id: CheckId,
  /** `skipped` and `failed` both mean the check produced no answer. Neither is ever a pass. */
  status: z.enum(['passed', 'flagged', 'skipped', 'failed']),
  detail: z.string().max(500).optional(),
})
export type Check = z.infer<typeof Check>

export const Finding = z.object({
  flag: FlagNameSchema,
  checkId: CheckId,
  title: z.string().min(1).max(120),
  location: z.string().max(200),
  excerpt: z.string().refine((text) => utf8Length(text) <= CONSTANTS.SHORT_PROOF_MAX_BYTES, 'excerpt is longer than 512 bytes'),
})
export type Finding = z.infer<typeof Finding>

export const ContractSource = z.object({
  kind: z.literal('contract'),
  address: AddressSchema,
  codehash: Bytes32Schema,
  blockNumber: UintStringSchema,
  implementation: z
    .object({ standard: z.enum(['eip1967', 'beacon', 'eip1167']), address: AddressSchema, codehash: Bytes32Schema })
    .optional(),
})
export type ContractSource = z.infer<typeof ContractSource>

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

export const SkillSource = z.object({
  kind: z.literal('skill'),
  /** GitHub repository as `owner/name`. */
  repo: z.string().regex(REPO_PATTERN),
  commit: z.string().regex(COMMIT_PATTERN),
  /** Skill folder inside the repository; empty for the repository root. */
  path: z.string().max(400),
  contentHash: Bytes32Schema,
  manifestPublisher: AddressSchema,
  canonicalBundleHash: Bytes32Schema,
  fileCount: z.number().int().min(1).max(CONSTANTS.MAX_BUNDLE_FILES),
  totalBytes: z.number().int().min(0).max(CONSTANTS.MAX_BUNDLE_BYTES),
})
export type SkillSource = z.infer<typeof SkillSource>

const flagsOf = (findings: readonly Finding[]): number => findings.reduce((bits, finding) => bits | FLAGS[finding.flag], 0)

export const ScanReport = z
  .object({
    schemaVersion: z.literal(1),
    targetType: TargetTypeSchema,
    targetId: Bytes32Schema,
    source: z.discriminatedUnion('kind', [ContractSource, SkillSource]),
    scannedAt: IsoDateSchema,
    checks: z.array(Check),
    findings: z.array(Finding),
    flags: FlagsSchema,
    /** What the scanner proposes. The Guardian still has to choose a verdict themselves. */
    suggestedVerdict: VerdictSchema.nullable(),
  })
  .superRefine((report, ctx) => {
    const isContract = report.targetType === 'SMART_CONTRACT'
    if ((report.source.kind === 'contract') !== isContract) {
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'source kind does not match the target type' })
    }
    const mask = isContract ? CONTRACT_FLAGS_MASK : SKILL_FLAGS_MASK
    const found = flagsOf(report.findings)
    if (found - (found & mask) !== 0) {
      ctx.addIssue({ code: 'custom', path: ['findings'], message: 'a finding uses a flag of the other target type' })
    }
    if (report.flags !== found) {
      ctx.addIssue({ code: 'custom', path: ['flags'], message: 'flags must equal the union of the finding flags' })
    }
    const ids = report.checks.map((check) => check.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: 'a check id appears more than once' })
    }
    // Doubt is never safe: SAFE needs every check to have run and passed, and no finding.
    const allPassed = report.checks.length > 0 && report.checks.every((check) => check.status === 'passed')
    if (report.suggestedVerdict === 'SAFE' && (!allPassed || report.findings.length > 0)) {
      ctx.addIssue({ code: 'custom', path: ['suggestedVerdict'], message: 'SAFE needs every check passed and no finding' })
    }
  })
export type ScanReport = z.infer<typeof ScanReport>

export type DecodedSrc =
  | { kind: 'contract'; address: `0x${string}` }
  | { kind: 'skill'; owner: string; repo: string; commit: string; path: string }

const ADDRESS_SRC = /^0x[0-9a-fA-F]{40}$/
const SKILL_SRC = /^gh:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([0-9a-f]{40}):(.*)$/
const isSafeName = (name: string): boolean => name !== '.' && name !== '..'
const isSafePath = (path: string): boolean =>
  path === '' || (!path.startsWith('/') && !path.includes('\\') && path.split('/').every((part) => part !== '' && isSafeName(part)))

/** Value of the `?src=` query that lets a target page be rebuilt from its source. */
export function encodeSrc(source: ContractSource | SkillSource): string {
  return source.kind === 'contract' ? source.address.toLowerCase() : `gh:${source.repo}@${source.commit}:${source.path}`
}

/** Returns null for anything that is not a contract address or a pinned GitHub skill reference. */
export function decodeSrc(src: string): DecodedSrc | null {
  if (ADDRESS_SRC.test(src)) return { kind: 'contract', address: src.toLowerCase() as `0x${string}` }
  const match = SKILL_SRC.exec(src)
  if (!match) return null
  const [, owner = '', repo = '', commit = '', path = ''] = match
  if (!isSafeName(owner) || !isSafeName(repo) || !isSafePath(path)) return null
  return { kind: 'skill', owner, repo, commit, path }
}
