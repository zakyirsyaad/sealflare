import { z } from 'zod'
import { CONSTANTS, TRUST_TIERS } from '../rules'
import { envelope } from './api'
import {
  AddressSchema,
  Bytes32Schema,
  FlagsSchema,
  IsoDateSchema,
  TargetTypeSchema,
  UintStringSchema,
  VerdictSchema,
  utf8Length,
} from './primitives'
import { SandboxResult } from './sandbox'
import { ScanReport, decodeSrc } from './scan'

/**
 * Read models: the contract between the indexer/internal service and the web app. Every answer
 * here is built from indexed data, so it carries meta.finalizedBlock. Wei amounts are decimal
 * integer strings and timestamps are ISO strings. Tiers come from Core.tierOf and are never
 * recomputed here; the signal is never collapsed into one number.
 */

/** The frozen TrustTier enum as a schema. primitives.ts is frozen, so it lives here. */
export const TrustTierSchema = z.enum(TRUST_TIERS)

/** uint32 counts and weight sums: whole and non-negative. */
const Count = z.number().int().min(0)
/** One guardian's vote weight W(S), frozen as 0..5 by weightOf in rules/weight.ts. */
const VoteWeight = z.number().int().min(0).max(5)
/** The on-chain short proof holds at most 512 bytes of UTF-8. */
const ShortProof = z
  .string()
  .refine((text) => utf8Length(text) <= CONSTANTS.SHORT_PROOF_MAX_BYTES, 'shortProof is longer than 512 bytes')

const LIST_LIMIT_MAX = 100

/** Read endpoints share the common error codes plus NOT_FOUND for unknown ids and addresses. */
const READ_ERROR_CODES = ['NOT_FOUND'] as const

/**
 * envelope() leaves meta optional. A read answer built from indexer data must name the last
 * final block it read, and a paged list must also carry its page. Error answers stay untouched.
 */
function indexedEnvelope<T extends z.ZodType>(data: T, paged: boolean) {
  return envelope(data, READ_ERROR_CODES).superRefine((answer, ctx) => {
    if (!answer.success) return
    // `in` narrows the union for the type checker; a missing meta key reads as undefined.
    const meta = 'meta' in answer ? answer.meta : undefined
    if (meta?.finalizedBlock === undefined) {
      ctx.addIssue({ code: 'custom', path: ['meta', 'finalizedBlock'], message: 'a read answer must carry meta.finalizedBlock' })
    }
    if (paged && meta?.page === undefined) {
      ctx.addIssue({ code: 'custom', path: ['meta', 'page'], message: 'a list answer must carry meta.page' })
    }
  })
}

export const SignalGroup = z.object({
  votes: z.object({ safe: Count, caution: Count, danger: Count }),
  weight: z.object({ safe: Count, caution: Count, danger: Count }),
  flags: FlagsSchema,
})
export type SignalGroup = z.infer<typeof SignalGroup>

export const TargetSummary = z.object({
  targetId: Bytes32Schema,
  targetType: TargetTypeSchema,
  label: z.string().min(1),
  /** An indexed skill may have no pinned GitHub reference yet. */
  src: z.string().nullable(),
  tier: TrustTierSchema,
  safe: Count,
  caution: Count,
  danger: Count,
  publisherRole: z.enum(['NONE', 'THIRD_PARTY_SPONSOR', 'VERIFIED_PUBLISHER']),
  /** Wei, decimal integer string. */
  bond: UintStringSchema,
  lastVoteAt: IsoDateSchema.nullable(),
}).refine(({ targetType, src }) => {
  if (src === null) return targetType === 'AI_SKILL_BUNDLE'
  const expectedKind = targetType === 'SMART_CONTRACT' ? 'contract' : 'skill'
  return decodeSrc(src)?.kind === expectedKind
}, { path: ['src'], message: 'src must match the target type' })
export type TargetSummary = z.infer<typeof TargetSummary>

export const TargetDetail = TargetSummary.safeExtend({
  publisher: AddressSchema.nullable(),
  pinnedCodehash: Bytes32Schema,
  hasDelegatecall: z.boolean(),
  activeFlags: FlagsSchema,
  /** Both breakdowns are always present; the signal never collapses into one number. */
  signal: z.object({ newIds: SignalGroup, guardians: SignalGroup }),
  /** uint256 challenge id as a decimal integer string, null when no dispute is open. */
  activeChallengeId: UintStringSchema.nullable(),
  attestationCount: Count,
  scan: ScanReport.nullable(),
  sandbox: SandboxResult.nullable(),
})
export type TargetDetail = z.infer<typeof TargetDetail>

export const AttestationRow = z.object({
  index: Count,
  guardian: AddressSchema,
  verdict: VerdictSchema,
  flags: FlagsSchema,
  weight: VoteWeight,
  safeOrdinal: Count,
  shortProof: ShortProof,
  /** Core can emit an empty URI when no evidence is linked. */
  evidenceURI: z.string(),
  txHash: Bytes32Schema,
  at: IsoDateSchema,
  settled: z.boolean(),
  castDuringDispute: z.boolean(),
})
export type AttestationRow = z.infer<typeof AttestationRow>

export const ActivityItem = z.object({
  kind: z.enum(['attestation', 'juror', 'challenge', 'bounty', 'bond']),
  targetId: Bytes32Schema,
  label: z.string().min(1),
  result: z.string().min(1),
  /** XP can be negative (penalties); null when the event earns no XP. */
  xp: z.number().int().nullable(),
  at: IsoDateSchema,
})
export type ActivityItem = z.infer<typeof ActivityItem>

export const NeedsAction = z.object({
  kind: z.enum(['REVEAL_DUE', 'REPLY_DUE', 'CAN_CLOSE', 'XP_CLAIMABLE', 'BOND_READY', 'BOUNTY_SETTLEABLE']),
  targetId: Bytes32Schema,
  challengeId: UintStringSchema.optional(),
  bountyId: z.string().min(1).optional(),
  dueAt: IsoDateSchema.optional(),
  detail: z.string().min(1),
})
export type NeedsAction = z.infer<typeof NeedsAction>

export const Activity = z.object({
  needsAction: z.array(NeedsAction),
  /** Withdrawable wei, decimal integer string. */
  balance: UintStringSchema,
  score: z.number().int(),
  weight: VoteWeight,
  toNextWeight: Count.nullable(),
  history: z.array(ActivityItem),
})
export type Activity = z.infer<typeof Activity>

export const GuardianSummary = z.object({
  address: AddressSchema,
  /** int32 on-chain; penalties can push it below zero. */
  score: z.number().int(),
  weight: VoteWeight,
  attestations: Count,
  penaltyPending: z.boolean(),
})
export type GuardianSummary = z.infer<typeof GuardianSummary>

export const GuardianDetail = GuardianSummary.extend({
  createdAtBlock: UintStringSchema,
  history: z.array(ActivityItem),
})
export type GuardianDetail = z.infer<typeof GuardianDetail>

export const ChallengeSummary = z.object({
  /** uint256 on-chain, carried as a decimal integer string. */
  id: UintStringSchema,
  targetId: Bytes32Schema,
  label: z.string().min(1),
  challenger: AddressSchema,
  phase: z.enum(['COMMIT', 'REVEAL', 'AWAITING_CLOSE', 'CLOSED']),
  outcome: z.enum(['PENDING', 'UPHELD', 'REJECTED', 'TIED', 'EXPIRED']),
  commitEndsAt: IsoDateSchema,
  revealEndsAt: IsoDateSchema,
  commits: Count,
  reveals: Count,
})
export type ChallengeSummary = z.infer<typeof ChallengeSummary>

export const ChallengeDetail = ChallengeSummary.extend({
  flags: FlagsSchema,
  shortProof: ShortProof,
  evidenceURI: z.string().min(1),
  counterEvidenceURI: z.string().min(1).nullable(),
  publisher: AddressSchema.nullable(),
  jurors: z
    .array(
      z.object({
        address: AddressSchema,
        weight: VoteWeight,
        revealed: z.boolean(),
        uphold: z.boolean().nullable(),
      }),
    )
    .max(CONSTANTS.MAX_JURORS),
  upholdWeight: Count,
  rejectWeight: Count,
  payouts: z.array(z.object({ recipient: AddressSchema, amount: UintStringSchema })),
}).superRefine((challenge, ctx) => {
  // Commit-reveal secrecy: while commits are open, no vote direction may be visible.
  if (challenge.phase !== 'COMMIT') return
  challenge.jurors.forEach((juror, index) => {
    if (juror.uphold !== null) {
      ctx.addIssue({ code: 'custom', path: ['jurors', index, 'uphold'], message: 'a vote direction cannot be known during the commit phase' })
    }
  })
})
export type ChallengeDetail = z.infer<typeof ChallengeDetail>

export const BountySummary = z.object({
  /** Opaque indexer-assigned id; the frozen contracts key bounties by target, not by a numeric id. */
  id: z.string().min(1),
  targetId: Bytes32Schema,
  label: z.string().min(1),
  requester: AddressSchema,
  slots: z.number().int().min(CONSTANTS.BOUNTY_MIN_SLOTS).max(CONSTANTS.BOUNTY_MAX_SLOTS),
  filled: Count,
  /** Wei, decimal integer string. */
  amount: UintStringSchema,
  createdAt: IsoDateSchema,
  settleableAt: IsoDateSchema.nullable(),
  settled: z.boolean(),
})
export type BountySummary = z.infer<typeof BountySummary>

export const BountyDetail = BountySummary.extend({
  fillers: z.array(z.object({ guardian: AddressSchema, verdict: VerdictSchema })),
})
export type BountyDetail = z.infer<typeof BountyDetail>

export const ListQuery = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
  address: AddressSchema.optional(),
  type: TargetTypeSchema.optional(),
  tier: TrustTierSchema.optional(),
})
export type ListQuery = z.infer<typeof ListQuery>

const TargetsListData = z.object({ items: z.array(TargetSummary) })
const AttestationsListData = z.object({ items: z.array(AttestationRow) })
const GuardiansListData = z.object({ items: z.array(GuardianSummary) })
const ChallengesListData = z.object({ items: z.array(ChallengeSummary) })
const BountiesListData = z.object({ items: z.array(BountySummary) })

export const TargetsListResponse = indexedEnvelope(TargetsListData, true)
export const TargetDetailResponse = indexedEnvelope(TargetDetail, false)
export const AttestationsListResponse = indexedEnvelope(AttestationsListData, true)
export const GuardiansListResponse = indexedEnvelope(GuardiansListData, true)
export const GuardianDetailResponse = indexedEnvelope(GuardianDetail, false)
export const ChallengesListResponse = indexedEnvelope(ChallengesListData, true)
export const ChallengeDetailResponse = indexedEnvelope(ChallengeDetail, false)
export const BountiesListResponse = indexedEnvelope(BountiesListData, true)
export const BountyDetailResponse = indexedEnvelope(BountyDetail, false)
export const ActivityResponse = indexedEnvelope(Activity, false)
