import { targetIdOfContract } from '@sealflare/shared/rules'
import type { Db } from '../src/db'

/**
 * The rows the indexer would write. The tests write them directly, because the read routes do
 * not care where the rows come from.
 */
export const CONTRACT = '0x1111111111111111111111111111111111111111'
/** The target id the contract gives this address, so a scan report matches its target. */
export const CONTRACT_ID = targetIdOfContract(CONTRACT)
export const GUARDIAN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const GUARDIAN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export const ZERO_HASH = `0x${'0'.repeat(64)}`

export function targetId(seed: number): string {
  return `0x${seed.toString(16).padStart(64, '0')}`
}

export interface TargetSeed {
  id: string
  type?: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  label?: string
  src?: string | null
  codehash?: string | null
  bundleHash?: string | null
  publisher?: string | null
  publisherRole?: 'NONE' | 'THIRD_PARTY_SPONSOR' | 'VERIFIED_PUBLISHER'
  bond?: string
  activeFlags?: number
  confirmedDanger?: boolean
  hasDelegatecall?: boolean
  activeChallengeId?: string | null
  safe?: number
  caution?: number
  danger?: number
  lastVoteAt?: string | null
}

export async function insertTarget(db: Db, seed: TargetSeed): Promise<void> {
  await db.query(
    `INSERT INTO targets (target_id, target_type, label, src, codehash, bundle_hash, publisher,
       publisher_role, bond, active_flags, confirmed_danger, has_delegatecall, active_challenge_id,
       safe_count, caution_count, danger_count, created_at_block, last_vote_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $17)`,
    [
      seed.id,
      seed.type ?? 'SMART_CONTRACT',
      seed.label ?? seed.id,
      seed.src === undefined ? CONTRACT : seed.src,
      seed.codehash === undefined ? ZERO_HASH : seed.codehash,
      seed.bundleHash ?? null,
      seed.publisher ?? null,
      seed.publisherRole ?? 'NONE',
      seed.bond ?? '0',
      seed.activeFlags ?? 0,
      seed.confirmedDanger ?? false,
      seed.hasDelegatecall ?? false,
      seed.activeChallengeId ?? null,
      seed.safe ?? 0,
      seed.caution ?? 0,
      seed.danger ?? 0,
      seed.lastVoteAt ?? null,
    ],
  )
}

export interface VoteSeed {
  targetId: string
  guardian?: string
  verdict?: 'SAFE' | 'CAUTION' | 'DANGER'
  flags?: number
  weight?: number
  index: number
  safeOrdinal?: number
  shortProof?: string
  evidenceUri?: string
  settled?: boolean
  castDuringDispute?: boolean
  at?: string
}

export async function insertVote(db: Db, seed: VoteSeed): Promise<void> {
  await db.query(
    `INSERT INTO attestations (tx_hash, log_index, target_id, guardian, verdict, flags, weight,
       attestation_index, safe_ordinal, short_proof, evidence_uri, cast_during_dispute, settled, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      `0x${seed.index.toString(16).padStart(64, '0')}`,
      seed.index,
      seed.targetId,
      seed.guardian ?? GUARDIAN,
      seed.verdict ?? 'SAFE',
      seed.flags ?? 0,
      seed.weight ?? 1,
      seed.index,
      seed.safeOrdinal ?? seed.index,
      seed.shortProof ?? '0x',
      seed.evidenceUri ?? '',
      seed.castDuringDispute ?? false,
      seed.settled ?? false,
      seed.at ?? '2026-11-25T10:00:00.000Z',
    ],
  )
}

export async function insertCursor(db: Db, block: number): Promise<void> {
  await db.query(
    `INSERT INTO cursor (id, last_block, last_block_hash) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block`,
    [CONTRACT, block.toString(), `0x${'11'.repeat(32)}`],
  )
}


export interface Answer<T> {
  success: boolean
  data?: T
  meta?: { finalizedBlock?: string; page?: { total: number; page: number; limit: number } }
  error?: { code: string; message: string }
}

export const asAnswer = <T,>(value: unknown): Answer<T> => value as Answer<T>
