import { expect, test } from 'vitest'
import { toNextWeight } from '../src/readModel/activity'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, GUARDIAN, GUARDIAN_B, insertTarget, insertVote, targetId } from './targets.seed'
import { insertBalance, insertBond, insertBounty, insertChallenge, insertFiller, insertJuror } from './court.seed'

/**
 * The activity of an account: what it has to do, what it may withdraw and what it did.
 */

const NOW = new Date('2026-11-26T12:00:00.000Z')

interface ActivityAnswer {
  needsAction: { kind: string; targetId: string; challengeId?: string; bountyId?: string; dueAt?: string }[]
  balance: string
  score: number
  weight: number
  toNextWeight: number | null
  history: { kind: string; result: string; xp: number | null; at: string }[]
}

async function readActivity(db: Parameters<typeof testApp>[0], address: string): Promise<ActivityAnswer> {
  const { app } = testApp(db, { now: () => NOW })
  const answer = asAnswer<ActivityAnswer>(await body(await get(app, `/activity/${address}`)))
  expect(answer.success).toBe(true)
  return answer.data as ActivityAnswer
}

test('a committed vote in the reveal phase appears as REVEAL_DUE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(31)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '7',
    targetId: id,
    challenger: GUARDIAN,
    commitEndsAt: '2026-11-26T00:00:00.000Z',
    revealEndsAt: '2026-11-26T23:00:00.000Z',
  })
  await insertJuror(db, { challengeId: '7', address: GUARDIAN, revealed: false })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'REVEAL_DUE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, challengeId: '7', dueAt: '2026-11-26T23:00:00.000Z' })
  await close()
})

test('a challenge on my target in the commit phase appears as REPLY_DUE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(32)
  await insertTarget(db, { id, publisher: GUARDIAN, publisherRole: 'VERIFIED_PUBLISHER' })
  await insertChallenge(db, {
    id: '8',
    targetId: id,
    challenger: '0xcccccccccccccccccccccccccccccccccccccccc',
    commitEndsAt: '2026-11-26T20:00:00.000Z',
    revealEndsAt: '2026-11-27T08:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'REPLY_DUE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, challengeId: '8' })
  await close()
})

test('a challenge past the reveal phase appears as CAN_CLOSE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(33)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '9',
    targetId: id,
    challenger: GUARDIAN,
    reveals: 3,
    commitEndsAt: '2026-11-25T12:00:00.000Z',
    revealEndsAt: '2026-11-26T00:00:00.000Z',
  })
  await insertJuror(db, { challengeId: '9', address: GUARDIAN, revealed: true, uphold: true })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'CAN_CLOSE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, challengeId: '9' })
  await close()
})

test('a challenge past the reveal phase without a quorum appears as CAN_CLOSE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(41)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '23',
    targetId: id,
    challenger: GUARDIAN,
    reveals: 0,
    commitEndsAt: '2026-11-25T12:00:00.000Z',
    revealEndsAt: '2026-11-26T00:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'CAN_CLOSE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, challengeId: '23' })
  await close()
})

test('a SAFE vote older than 48 hours appears as XP_CLAIMABLE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(34)
  await insertTarget(db, { id })
  await insertVote(db, {
    targetId: id,
    index: 0,
    guardian: GUARDIAN,
    verdict: 'SAFE',
    safeOrdinal: 1,
    at: '2026-11-24T10:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, dueAt: '2026-11-26T10:00:00.000Z' })
  await close()
})

test('the distance to the next weight follows the thresholds of the frozen rules', () => {
  const distances = [-5, 0, 9, 10, 24, 25, 49, 50, 99, 100, 250].map((score) => toNextWeight(score))
  expect(distances).toEqual([5, 10, 1, 15, 1, 25, 1, 50, 1, null, null])
  // A score that is no whole number earns no weight, so it has no next one to name either.
  expect(toNextWeight(2.5)).toBeNull()
})

/** A target the jury confirmed as dangerous: three votes were in when the verdict landed. */
async function confirmedDangerTarget(db: Parameters<typeof insertTarget>[0], id: string, withMoment = true) {
  await insertTarget(db, { id, confirmedDanger: true })
  if (!withMoment) return
  await db.query('UPDATE targets SET count_at_verdict = 3, verdict_at = $2 WHERE target_id = $1', [
    id,
    '2026-11-25T12:00:00.000Z',
  ])
}

test('a DANGER vote cast before the verdict that confirmed the danger appears as XP_CLAIMABLE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(70)
  await confirmedDangerTarget(db, id)
  await insertVote(db, { targetId: id, index: 1, guardian: GUARDIAN, verdict: 'DANGER', safeOrdinal: 0 })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, dueAt: '2026-11-25T12:00:00.000Z' })
  await close()
})

test('a DANGER vote that settles for nothing does not appear as XP_CLAIMABLE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(71)
  await confirmedDangerTarget(db, id)
  // Cast after the verdict (index 3 is the fourth vote), cast during a dispute, and already settled.
  await insertVote(db, { targetId: id, index: 3, guardian: GUARDIAN, verdict: 'DANGER', safeOrdinal: 0 })
  await insertVote(db, { targetId: id, index: 1, guardian: GUARDIAN_B, verdict: 'DANGER', safeOrdinal: 0, castDuringDispute: true })
  await insertVote(db, { targetId: id, index: 2, guardian: GUARDIAN, verdict: 'DANGER', safeOrdinal: 0, settled: true })

  const activity = await readActivity(db, GUARDIAN)
  expect(activity.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')).toHaveLength(0)
  const other = await readActivity(db, GUARDIAN_B)
  expect(other.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')).toHaveLength(0)
  await close()
})

test('a DANGER vote on a target that is not confirmed, or whose verdict moment is unknown, offers nothing', async () => {
  const { db, close } = await createTestDb()
  const open = targetId(72)
  const unknown = targetId(73)
  await insertTarget(db, { id: open })
  await confirmedDangerTarget(db, unknown, false)
  await insertVote(db, { targetId: open, index: 0, guardian: GUARDIAN, verdict: 'DANGER', safeOrdinal: 0 })
  await insertVote(db, { targetId: unknown, index: 1, guardian: GUARDIAN, verdict: 'DANGER', safeOrdinal: 0 })

  const activity = await readActivity(db, GUARDIAN)
  expect(activity.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')).toHaveLength(0)
  await close()
})

test('a SAFE vote that earns no XP does not appear as XP_CLAIMABLE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(42)
  await insertTarget(db, { id })
  // A vote past the slots that are rewarded earns nothing.
  await insertVote(db, {
    targetId: id,
    index: 0,
    guardian: GUARDIAN,
    verdict: 'SAFE',
    safeOrdinal: 11,
    at: '2026-11-24T10:00:00.000Z',
  })
  // A vote that was cast during a dispute earns nothing either.
  await insertVote(db, {
    targetId: id,
    index: 1,
    guardian: GUARDIAN,
    verdict: 'SAFE',
    safeOrdinal: 2,
    castDuringDispute: true,
    at: '2026-11-24T10:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'XP_CLAIMABLE')
  expect(actions).toEqual([])
  await close()
})

test('a bond withdrawal past 7 days appears as BOND_READY', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(35)
  await insertTarget(db, { id })
  await insertBond(db, {
    targetId: id,
    depositor: GUARDIAN,
    requestedAt: '2026-11-18T10:00:00.000Z',
    withdrawableAt: '2026-11-25T10:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'BOND_READY')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, dueAt: '2026-11-25T10:00:00.000Z' })
  await close()
})

test('a bond that a dispute holds does not appear as BOND_READY', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(43)
  await insertTarget(db, { id })
  await insertBond(db, {
    targetId: id,
    depositor: GUARDIAN,
    requestedAt: '2026-11-18T10:00:00.000Z',
    withdrawableAt: '2026-11-25T10:00:00.000Z',
    locked: true,
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'BOND_READY')
  expect(actions).toEqual([])
  await close()
})

test('my bounty past its settle time appears as BOUNTY_SETTLEABLE', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(36)
  await insertTarget(db, { id })
  await insertBounty(db, {
    id: '12',
    targetId: id,
    requester: GUARDIAN,
    settleableAt: '2026-11-26T08:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const actions = activity.needsAction.filter((action) => action.kind === 'BOUNTY_SETTLEABLE')
  expect(actions).toHaveLength(1)
  expect(actions[0]).toMatchObject({ targetId: id, bountyId: '12' })
  await close()
})

test('needs action is ordered by due time and empty when nothing is due', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(37)
  await insertTarget(db, { id })
  // Nothing is due yet, so the list is empty.
  await insertVote(db, { targetId: id, index: 0, guardian: GUARDIAN, at: '2026-11-26T11:00:00.000Z' })
  await insertBond(db, {
    targetId: id,
    depositor: GUARDIAN,
    requestedAt: '2026-11-26T10:00:00.000Z',
    withdrawableAt: '2026-12-03T10:00:00.000Z',
  })
  expect((await readActivity(db, GUARDIAN)).needsAction).toEqual([])

  // A vote that waits out 48 hours comes before a bond that waits out seven days.
  await insertVote(db, { targetId: id, index: 1, guardian: GUARDIAN, at: '2026-11-24T10:00:00.000Z' })
  const other = targetId(39)
  await insertTarget(db, { id: other })
  await insertBond(db, {
    targetId: other,
    depositor: GUARDIAN,
    requestedAt: '2026-11-18T10:00:00.000Z',
    withdrawableAt: '2026-11-25T10:00:00.000Z',
  })
  const activity = await readActivity(db, GUARDIAN)
  expect(activity.needsAction.map((action) => action.kind)).toEqual(['BOND_READY', 'XP_CLAIMABLE'])
  await close()
})

test('the balance is the sum of the credits minus the withdrawals', async () => {
  const { db, close } = await createTestDb()
  await insertBalance(db, { address: GUARDIAN, kind: 'CREDIT', amount: '400', logIndex: 1 })
  await insertBalance(db, { address: GUARDIAN, kind: 'CREDIT', amount: '600', logIndex: 2 })
  await insertBalance(db, { address: GUARDIAN, kind: 'WITHDRAW', amount: '400', logIndex: 3 })

  const activity = await readActivity(db, GUARDIAN)
  expect(activity.balance).toBe('600')
  await close()
})

test('the history holds the votes, the jury seats, the disputes, the bounties and the bonds', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(38)
  await insertTarget(db, { id, label: 'The target' })
  await insertVote(db, { targetId: id, index: 0, guardian: GUARDIAN, at: '2026-11-25T10:00:00.000Z' })
  await insertChallenge(db, {
    id: '20',
    targetId: id,
    challenger: GUARDIAN,
    outcome: 'UPHELD',
    createdAt: '2026-11-25T09:00:00.000Z',
  })
  await insertJuror(db, {
    challengeId: '20',
    address: GUARDIAN,
    revealed: true,
    uphold: true,
    at: '2026-11-25T09:30:00.000Z',
  })
  await insertBounty(db, { id: '21', targetId: id, requester: GUARDIAN, createdAt: '2026-11-25T08:00:00.000Z' })
  await insertFiller(db, { bountyId: '21', guardian: GUARDIAN, at: '2026-11-25T08:30:00.000Z' })

  const activity = await readActivity(db, GUARDIAN)
  const kinds = activity.history.map((item) => item.kind)
  expect(kinds).toContain('attestation')
  expect(kinds).toContain('juror')
  expect(kinds).toContain('challenge')
  expect(kinds).toContain('bounty')
  // The newest item comes first.
  expect(activity.history[0]?.at).toBe('2026-11-25T10:00:00.000Z')
  const dispute = activity.history.find((item) => item.kind === 'challenge')
  expect(dispute?.xp).toBe(5)
  await close()
})

test('a tie costs the challenger no XP', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(44)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '24',
    targetId: id,
    challenger: GUARDIAN,
    outcome: 'TIED',
    createdAt: '2026-11-25T09:00:00.000Z',
  })

  const activity = await readActivity(db, GUARDIAN)
  const dispute = activity.history.find((item) => item.kind === 'challenge')
  expect(dispute?.result).toBe('Tied')
  expect(dispute?.xp).toBeNull()
  await close()
})

test('a juror in the majority earned the juror XP, any other seat earned none', async () => {
  const { db, close } = await createTestDb()
  const id = targetId(41)
  await insertTarget(db, { id, label: 'The target' })
  const seats: { challengeId: string; outcome: 'UPHELD' | 'REJECTED' | 'TIED' | 'EXPIRED' | 'PENDING'; revealed: boolean; uphold: boolean | null; xp: number | null }[] = [
    { challengeId: '30', outcome: 'UPHELD', revealed: true, uphold: true, xp: 3 },
    { challengeId: '31', outcome: 'REJECTED', revealed: true, uphold: false, xp: 3 },
    { challengeId: '32', outcome: 'UPHELD', revealed: true, uphold: false, xp: null },
    { challengeId: '33', outcome: 'REJECTED', revealed: true, uphold: true, xp: null },
    { challengeId: '34', outcome: 'UPHELD', revealed: false, uphold: null, xp: null },
    { challengeId: '35', outcome: 'TIED', revealed: true, uphold: true, xp: null },
    { challengeId: '36', outcome: 'EXPIRED', revealed: true, uphold: true, xp: null },
    { challengeId: '37', outcome: 'PENDING', revealed: true, uphold: true, xp: null },
  ]
  for (const seat of seats) {
    await insertChallenge(db, { id: seat.challengeId, targetId: id, challenger: '0x' + '9'.repeat(40), outcome: seat.outcome })
    await insertJuror(db, { challengeId: seat.challengeId, address: GUARDIAN, revealed: seat.revealed, uphold: seat.uphold })
  }

  const activity = await readActivity(db, GUARDIAN)
  const jurorXp = activity.history.filter((item) => item.kind === 'juror').map((item) => item.xp)
  expect(jurorXp.filter((xp) => xp === 3)).toHaveLength(2)
  expect(jurorXp.filter((xp) => xp === null)).toHaveLength(seats.length - 2)
  await close()
})
