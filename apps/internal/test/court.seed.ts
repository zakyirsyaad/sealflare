import type { Db } from '../src/db'

/**
 * The rows the Court and the Vault would write. The tests write them directly, because the read
 * routes do not care where the rows come from.
 */

export interface ChallengeSeed {
  id: string
  targetId: string
  label?: string
  challenger: string
  phase?: 'COMMIT' | 'REVEAL' | 'AWAITING_CLOSE' | 'CLOSED'
  outcome?: 'PENDING' | 'UPHELD' | 'REJECTED' | 'TIED' | 'EXPIRED'
  flags?: number
  shortProof?: string
  evidenceUri?: string
  counterEvidenceUri?: string | null
  publisher?: string | null
  commits?: number
  reveals?: number
  commitEndsAt?: string
  revealEndsAt?: string
  createdAt?: string
  upholdWeight?: number
  rejectWeight?: number
}

export async function insertChallenge(db: Db, seed: ChallengeSeed): Promise<void> {
  await db.query(
    `INSERT INTO challenges (id, target_id, label, challenger, phase, outcome, flags, short_proof,
       evidence_uri, counter_evidence_uri, publisher, commits, reveals, commit_ends_at, reveal_ends_at,
       created_at_block, uphold_weight, reject_weight, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16, $17, $18)`,
    [
      seed.id,
      seed.targetId,
      seed.label ?? `Challenge ${seed.id}`,
      seed.challenger,
      seed.phase ?? 'COMMIT',
      seed.outcome ?? 'PENDING',
      seed.flags ?? 0,
      seed.shortProof ?? '0x',
      seed.evidenceUri ?? 'ipfs://evidence',
      seed.counterEvidenceUri ?? null,
      seed.publisher ?? null,
      seed.commits ?? 0,
      seed.reveals ?? 0,
      seed.commitEndsAt ?? '2026-11-25T12:00:00.000Z',
      seed.revealEndsAt ?? '2026-11-26T00:00:00.000Z',
      seed.upholdWeight ?? 0,
      seed.rejectWeight ?? 0,
      seed.createdAt ?? '2026-11-25T10:00:00.000Z',
    ],
  )
}

export interface JurorSeed {
  challengeId: string
  address: string
  weight?: number
  revealed?: boolean
  uphold?: boolean | null
  at?: string
}

export async function insertJuror(db: Db, seed: JurorSeed): Promise<void> {
  await db.query(
    `INSERT INTO jurors (challenge_id, address, weight, commit_hash, revealed, uphold, at)
     VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
    [
      seed.challengeId,
      seed.address,
      seed.weight ?? 1,
      seed.revealed ?? false,
      seed.uphold ?? null,
      seed.at ?? '2026-11-25T11:00:00.000Z',
    ],
  )
}

export interface BountySeed {
  id: string
  targetId: string
  label?: string
  requester: string
  slots?: number
  amount?: string
  createdAt?: string
  settleableAt?: string | null
  settled?: boolean
  startIndex?: number
}

export async function insertBounty(db: Db, seed: BountySeed): Promise<void> {
  await db.query(
    `INSERT INTO bounties (id, target_id, label, requester, slots, amount, created_at, settleable_at,
       settled, start_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      seed.id,
      seed.targetId,
      seed.label ?? `Bounty ${seed.id}`,
      seed.requester,
      seed.slots ?? 3,
      seed.amount ?? '1000',
      seed.createdAt ?? '2026-11-25T10:00:00.000Z',
      seed.settleableAt ?? null,
      seed.settled ?? false,
      seed.startIndex ?? 0,
    ],
  )
}

export async function insertFiller(
  db: Db,
  seed: { bountyId: string; guardian: string; verdict?: string; at?: string },
): Promise<void> {
  await db.query(
    'INSERT INTO bounty_fillers (bounty_id, guardian, verdict, at) VALUES ($1, $2, $3, $4)',
    [seed.bountyId, seed.guardian, seed.verdict ?? 'SAFE', seed.at ?? '2026-11-25T11:00:00.000Z'],
  )
}

export async function insertBond(
  db: Db,
  seed: {
    targetId: string
    depositor: string
    amount?: string
    requestedAt?: string | null
    withdrawableAt?: string | null
    finalizedAt?: string | null
    locked?: boolean
    createdAt?: string
  },
): Promise<void> {
  await db.query(
    `INSERT INTO bonds (target_id, depositor, amount, requested_at, withdrawable_at, finalized_at,
       locked, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      seed.targetId,
      seed.depositor,
      seed.amount ?? '500',
      seed.requestedAt ?? null,
      seed.withdrawableAt ?? null,
      seed.finalizedAt ?? null,
      seed.locked ?? false,
      seed.createdAt ?? '2026-11-25T10:00:00.000Z',
    ],
  )
}

export async function insertGuardian(
  db: Db,
  seed: {
    address: string
    score?: number
    weight?: number
    attestations?: number
    pendingPenalties?: number
    createdAtBlock?: number
  },
): Promise<void> {
  await db.query(
    `INSERT INTO guardians (address, score, weight, attestations, pending_penalties, created_at_block)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      seed.address,
      seed.score ?? 0,
      seed.weight ?? 1,
      seed.attestations ?? 0,
      seed.pendingPenalties ?? 0,
      seed.createdAtBlock ?? 1,
    ],
  )
}

export async function insertBalance(
  db: Db,
  seed: { address: string; kind: 'CREDIT' | 'WITHDRAW'; amount: string; logIndex?: number; at?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO balances (address, tx_hash, log_index, kind, amount, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      seed.address,
      `0x${(seed.logIndex ?? 0).toString(16).padStart(64, '0')}`,
      seed.logIndex ?? 0,
      seed.kind,
      seed.amount,
      seed.at ?? '2026-11-25T10:00:00.000Z',
    ],
  )
}

export async function insertPayout(
  db: Db,
  seed: { challengeId: string; recipient: string; amount: string; logIndex?: number; at?: string },
): Promise<void> {
  await db.query(
    `INSERT INTO payouts (challenge_id, tx_hash, log_index, recipient, amount, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      seed.challengeId,
      `0x${(seed.logIndex ?? 0).toString(16).padStart(64, '0')}`,
      seed.logIndex ?? 0,
      seed.recipient,
      seed.amount,
      seed.at ?? '2026-11-25T10:00:00.000Z',
    ],
  )
}
