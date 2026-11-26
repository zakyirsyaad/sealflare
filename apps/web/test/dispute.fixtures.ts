import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { ChallengeDetail, ChallengeSummary } from '@sealflare/shared/schemas'

export { address, contractScan, hiddenMint, scan, targetId, txHash, unverified } from './attest.fixtures'

export const COURT = '0x2000000000000000000000000000000000000002'
export const CORE = '0x1000000000000000000000000000000000000001'
export const CHALLENGER = '0x8f00000000000000000000000000000000000021'
export const ME = '0x5200000000000000000000000000000000000c19'
export const JUROR_ONE = '0x7100000000000000000000000000000000000001'
export const JUROR_TWO = '0x7200000000000000000000000000000000000002'
export const JUROR_THREE = '0x7300000000000000000000000000000000000003'

/** The moment every dispute test lives at. The Court counts the windows from here. */
export const NOW = new Date('2026-12-01T10:00:00.000Z')

const HOUR = 3_600_000

export const iso = (offsetHours: number): string => new Date(NOW.getTime() + offsetHours * HOUR).toISOString()

const target = targetIdOfContract('0x60b9262456de011f7d15a54cdd8c48baaa8b022f')

/** A dispute in its commit phase: 4 hours 12 minutes of commit left, and two jurors committed. */
export function summary(overrides: Record<string, unknown> = {}): ChallengeSummary {
  return ChallengeSummary.parse({
    id: '12',
    targetId: target,
    label: '0x60b9262456de011f7d15a54cdd8c48baaa8b022f',
    challenger: CHALLENGER,
    phase: 'COMMIT',
    outcome: 'PENDING',
    commitEndsAt: new Date(NOW.getTime() + 4 * HOUR + 12 * 60_000).toISOString(),
    revealEndsAt: new Date(NOW.getTime() + 16 * HOUR + 12 * 60_000).toISOString(),
    commits: 2,
    reveals: 0,
    ...overrides,
  })
}

export function detail(overrides: Record<string, unknown> = {}): ChallengeDetail {
  return ChallengeDetail.parse({
    ...summary(),
    flags: FLAGS.HIDDEN_MINT,
    shortProof: 'HIDDEN_MINT @ owner.mint: function mint(address to, uint256 amount) external onlyOwner',
    evidenceURI: 'ipfs://bafyevidence',
    counterEvidenceURI: null,
    publisher: null,
    jurors: [],
    upholdWeight: 0,
    rejectWeight: 0,
    payouts: [],
    ...overrides,
  })
}

/** A dispute that ended with the challenge upheld: 7 against 3, three jurors revealed. */
export function closedUpheld(overrides: Record<string, unknown> = {}): ChallengeDetail {
  return detail({
    phase: 'CLOSED',
    outcome: 'UPHELD',
    commits: 3,
    reveals: 3,
    upholdWeight: 7,
    rejectWeight: 3,
    jurors: [
      { address: JUROR_ONE, weight: 3, revealed: true, uphold: true },
      { address: JUROR_TWO, weight: 4, revealed: true, uphold: true },
      { address: JUROR_THREE, weight: 3, revealed: true, uphold: false },
    ],
    payouts: [
      { recipient: CHALLENGER, amount: '10000000000000000' },
      { recipient: JUROR_ONE, amount: '5000000000000000' },
    ],
    ...overrides,
  })
}
