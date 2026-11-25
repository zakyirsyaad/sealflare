import { expect, test } from 'vitest'
import { body, createTestDb, get, testApp } from './helpers'
import { asAnswer, GUARDIAN, GUARDIAN_B, insertTarget, targetId } from './targets.seed'
import { insertChallenge, insertJuror, insertPayout } from './court.seed'

/**
 * The disputes the Court brought, and the secrecy of the votes that are not revealed yet.
 */

const NOW = new Date('2026-11-26T12:00:00.000Z')

test('the dispute list is paged and the newest dispute comes first', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const first = targetId(51)
  const second = targetId(52)
  await insertTarget(db, { id: first })
  await insertTarget(db, { id: second })
  await insertChallenge(db, { id: '1', targetId: first, challenger: GUARDIAN, createdAt: '2026-11-25T09:00:00.000Z' })
  await insertChallenge(db, { id: '2', targetId: second, challenger: GUARDIAN_B, createdAt: '2026-11-25T10:00:00.000Z' })

  const answer = asAnswer<{ items: { id: string }[] }>(await body(await get(app, '/challenges')))
  expect(answer.success).toBe(true)
  expect(answer.data?.items.map((item) => item.id)).toEqual(['2', '1'])
  expect(answer.meta?.page).toEqual({ total: 2, page: 1, limit: 20 })
  await close()
})

test('the phase of a dispute is the phase it is in right now', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const id = targetId(53)
  await insertTarget(db, { id })
  // The row still says COMMIT, but the commit window is over.
  await insertChallenge(db, {
    id: '3',
    targetId: id,
    challenger: GUARDIAN,
    phase: 'COMMIT',
    commitEndsAt: '2026-11-26T00:00:00.000Z',
    revealEndsAt: '2026-11-26T23:00:00.000Z',
  })

  const answer = asAnswer<{ items: { phase: string }[] }>(await body(await get(app, '/challenges')))
  expect(answer.data?.items[0]?.phase).toBe('REVEAL')
  await close()
})

test('the direction of a vote stays empty until the challenge leaves the commit phase', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const id = targetId(54)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '4',
    targetId: id,
    challenger: GUARDIAN,
    phase: 'COMMIT',
    commitEndsAt: '2026-11-26T20:00:00.000Z',
    revealEndsAt: '2026-11-27T08:00:00.000Z',
  })
  await insertJuror(db, { challengeId: '4', address: GUARDIAN_B, revealed: false })
  await insertJuror(db, { challengeId: '4', address: GUARDIAN, revealed: true, uphold: true })

  const answer = asAnswer<{ jurors: { address: string; uphold: boolean | null }[] }>(
    await body(await get(app, '/challenges/4')),
  )
  expect(answer.success).toBe(true)
  // The commit phase never shows a direction, not even of a vote that was revealed.
  expect(answer.data?.jurors.every((juror) => juror.uphold === null)).toBe(true)
  await close()
})

test('a revealed vote shows its direction once the reveal window is over', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const id = targetId(55)
  await insertTarget(db, { id })
  await insertChallenge(db, {
    id: '5',
    targetId: id,
    challenger: GUARDIAN,
    phase: 'COMMIT',
    commitEndsAt: '2026-11-25T12:00:00.000Z',
    revealEndsAt: '2026-11-26T00:00:00.000Z',
  })
  await insertJuror(db, { challengeId: '5', address: GUARDIAN, revealed: true, uphold: true })
  await insertJuror(db, { challengeId: '5', address: GUARDIAN_B, revealed: false })

  const answer = asAnswer<{ phase: string; jurors: { address: string; uphold: boolean | null }[] }>(
    await body(await get(app, '/challenges/5')),
  )
  expect(answer.data?.phase).toBe('AWAITING_CLOSE')
  const byAddress = new Map(answer.data?.jurors.map((juror) => [juror.address, juror.uphold]))
  expect(byAddress.get(GUARDIAN)).toBe(true)
  expect(byAddress.get(GUARDIAN_B)).toBeNull()
  await close()
})

test('the payouts of a dispute are the rows of that dispute alone', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const first = targetId(56)
  const second = targetId(57)
  await insertTarget(db, { id: first })
  await insertTarget(db, { id: second })
  await insertChallenge(db, { id: '6', targetId: first, challenger: GUARDIAN })
  await insertChallenge(db, { id: '7', targetId: second, challenger: GUARDIAN })
  await insertPayout(db, { challengeId: '6', recipient: GUARDIAN, amount: '400', logIndex: 1 })
  await insertPayout(db, { challengeId: '7', recipient: GUARDIAN_B, amount: '900', logIndex: 2 })

  const answer = asAnswer<{ payouts: { recipient: string; amount: string }[] }>(
    await body(await get(app, '/challenges/6')),
  )
  expect(answer.data?.payouts).toEqual([{ recipient: GUARDIAN, amount: '400' }])
  await close()
})

test('a dispute the database does not have is not found', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const response = await get(app, '/challenges/99')
  expect(response.status).toBe(404)
  await close()
})

test('an id that is not a whole number is refused', async () => {
  const { db, close } = await createTestDb()
  const { app } = testApp(db, { now: () => NOW })
  const response = await get(app, '/challenges/abc')
  expect(response.status).toBe(400)
  await close()
})
