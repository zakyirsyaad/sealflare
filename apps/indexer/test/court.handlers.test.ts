import { expect, test } from 'vitest'
import {
  account,
  activeChallengeOf,
  addresses,
  attest,
  chainClient,
  commitVote,
  createTestDb,
  expireChallenge,
  openChallenge,
  resolveChallenge,
  revealVote,
  submitCounterEvidence,
  targetAddress,
  targetIdOf,
} from './helpers'
import { indexOnce } from '../src/loop'

/**
 * The Court rows the indexer writes.
 *
 * The chain is shared by the whole run, so every test opens its dispute on a target of its own
 * and reads the dispute back by the id of that target.
 */

const all = () => {
  const found = addresses()
  return { core: found.core, court: found.court, vault: found.vault }
}

test('a challenge row follows ChallengeOpened, VoteCommitted, VoteRevealed, ChallengeResolved', async () => {
  const target = targetAddress(0x81)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await commitVote({ from: 2, challengeId: id })
  await revealVote({ from: 2, challengeId: id, uphold: true })
  await resolveChallenge({ from: 3, challengeId: id })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const challenges = await db.query<Record<string, unknown>>('SELECT * FROM challenges WHERE id = $1', [id.toString()])
  expect(challenges).toHaveLength(1)
  expect(challenges[0]).toMatchObject({
    id: id.toString(),
    target_id: targetIdOf(target),
    challenger: account(1).address.toLowerCase(),
    phase: 'CLOSED',
    outcome: 'UPHELD',
    commits: 1,
    reveals: 1,
    reject_weight: 0,
  })

  const jurors = await db.query<Record<string, unknown>>('SELECT * FROM jurors WHERE challenge_id = $1', [id.toString()])
  expect(jurors).toHaveLength(1)
  expect(jurors[0]).toMatchObject({
    address: account(2).address.toLowerCase(),
    revealed: true,
    uphold: true,
  })
  // The weight of the side is the weight of the juror that is on it.
  expect(challenges[0]?.uphold_weight).toBe(jurors[0]?.weight)
  await close()
})

test('the short proof of a dispute is kept as the text it is', async () => {
  const target = targetAddress(0x86)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({
    from: 1,
    targetId: targetIdOf(target),
    shortProof: `0x${Buffer.from('UNLIMITED_APPROVAL_REQUEST').toString('hex')}` as `0x${string}`,
  })
  const id = await activeChallengeOf(targetIdOf(target))

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const challenges = await db.query<{ short_proof: string }>('SELECT short_proof FROM challenges WHERE id = $1', [
    id.toString(),
  ])
  expect(challenges[0]?.short_proof).toBe('UNLIMITED_APPROVAL_REQUEST')
  await close()
})

test('the direction of a vote stays empty until the juror reveals it', async () => {
  const target = targetAddress(0x82)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await commitVote({ from: 2, challengeId: id })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const jurors = await db.query<Record<string, unknown>>('SELECT * FROM jurors WHERE challenge_id = $1', [id.toString()])
  expect(jurors).toHaveLength(1)
  // The commit carries no direction, so the row holds none either.
  expect(jurors[0]?.uphold).toBeNull()
  expect(jurors[0]?.revealed).toBe(false)
  await close()
})

test('a dispute that ran out of time is closed as expired', async () => {
  const target = targetAddress(0x83)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await expireChallenge({ from: 3, challengeId: id })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const challenges = await db.query<Record<string, unknown>>('SELECT * FROM challenges WHERE id = $1', [id.toString()])
  expect(challenges[0]).toMatchObject({ phase: 'CLOSED', outcome: 'EXPIRED' })
  await close()
})

test('the reply of the publisher is kept with the dispute', async () => {
  const target = targetAddress(0x84)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await submitCounterEvidence({ from: 1, challengeId: id, uri: 'ipfs://reply' })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const challenges = await db.query<Record<string, unknown>>('SELECT * FROM challenges WHERE id = $1', [id.toString()])
  expect(challenges[0]?.counter_evidence_uri).toBe('ipfs://reply')
  expect(challenges[0]?.publisher).toBe(account(1).address.toLowerCase())
  await close()
})

test('a vote of a dispute the database does not have stops the indexer', async () => {
  const target = targetAddress(0x85)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  const opened = await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await commitVote({ from: 2, challengeId: id })

  // The dispute was opened before the start block, so the database never heard of it.
  await expect(
    indexOnce({ client: chainClient(), sql: db, addresses: all(), startBlock: BigInt(opened.blockNumber) + 1n }),
  ).rejects.toThrow(/challenge/)
  await close()
})
