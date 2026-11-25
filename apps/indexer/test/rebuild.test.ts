import { expect, test } from 'vitest'
import type { Db } from '@sealflare/internal/db'
import {
  account,
  activeChallengeOf,
  addresses,
  attest,
  chainClient,
  commitVote,
  createBounty,
  createTestDb,
  distribute,
  openChallenge,
  resolveChallenge,
  targetAddress,
  targetIdOf,
} from './helpers'
import { indexOnce } from '../src/loop'

const all = () => {
  const found = addresses()
  return { core: found.core, court: found.court, vault: found.vault }
}

const FIRST = targetAddress(0xa1)
const SECOND = targetAddress(0xa2)
const THIRD = targetAddress(0xa3)
const FOURTH = targetAddress(0xa4)
const FIFTH = targetAddress(0xa5)

const TABLES = [
  'cursor',
  'events',
  'targets',
  'attestations',
  'guardians',
  'score_changes',
  'challenges',
  'jurors',
  'bonds',
  'bounties',
  'bounty_fillers',
  'balances',
  'payouts',
  'escrow_movements',
]

test('rebuilding from block 0 yields byte-identical tables', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: FIRST, verdict: 0 })
  await attest({ from: 1, contract: FIRST, verdict: 2, flags: 1 })
  await attest({ from: 2, contract: SECOND, verdict: 1 })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const first = await dump(db)

  await empty(db)
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const second = await dump(db)

  expect(second).toEqual(first)
  await close()
})

test('rebuilding with all three contracts yields identical tables', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: FOURTH })
  await openChallenge({ from: 1, targetId: targetIdOf(FOURTH) })
  const id = await activeChallengeOf(targetIdOf(FOURTH))
  await commitVote({ from: 2, challengeId: id, value: 1000n })
  await distribute({ from: 3, challengeId: id, recipients: [account(4).address], amounts: [400n] })
  await resolveChallenge({ from: 3, challengeId: id })
  await attest({ from: 1, contract: FIFTH })
  await createBounty({ from: 2, targetId: targetIdOf(FIFTH), slots: 3 })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const first = await dump(db)

  await empty(db)
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const second = await dump(db)

  expect(second).toEqual(first)
  // The rebuild holds the rows of the three contracts, not only the ones of the Core.
  expect(first).toContain('challenges (')
  expect(first).toContain('payouts (')
  await close()
})

test('a crash in the middle of a range leaves no row twice and misses no event', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: THIRD })
  await openChallenge({ from: 1, targetId: targetIdOf(THIRD) })
  const id = await activeChallengeOf(targetIdOf(THIRD))
  await commitVote({ from: 2, challengeId: id, value: 1000n })

  // The range fails after a few events were written, so the transaction has to roll back.
  await expect(
    indexOnce({ client: chainClient(), sql: crashing(db, 3), addresses: all() }),
  ).rejects.toThrow('the write failed')
  expect(await db.query('SELECT * FROM events')).toHaveLength(0)
  expect(await db.query('SELECT * FROM challenges')).toHaveLength(0)
  expect(await db.query('SELECT * FROM jurors')).toHaveLength(0)

  // The range is read again, and it holds everything the first run had.
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const retried = await dump(db)

  await empty(db)
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const rebuilt = await dump(db)

  expect(retried).toEqual(rebuilt)
  const challenges = await db.query('SELECT * FROM challenges')
  expect(challenges.length).toBeGreaterThan(0)
  const jurors = await db.query('SELECT * FROM jurors')
  expect(jurors.length).toBeGreaterThan(0)
  await close()
})

/** Reads every table the indexer fills, in a shape two runs can be compared by. */
async function dump(db: Db): Promise<string> {
  const parts: string[] = []
  for (const table of TABLES) {
    const rows = await db.query(`SELECT * FROM ${table}`)
    const sorted = rows.map((row) => JSON.stringify(row)).sort()
    parts.push(`${table} (${sorted.length})\n${sorted.join('\n')}`)
  }
  return parts.join('\n\n')
}

/** Empties every table the indexer fills, so the next run builds them again. */
async function empty(db: Db): Promise<void> {
  await db.exec(`TRUNCATE ${TABLES.join(', ')} CASCADE`)
}

/** A database whose write fails after the given number of events, so the range breaks in the middle. */
function crashing(db: Db, after: number): Db {
  let seen = 0
  const fail = (text: string): boolean => {
    if (!text.includes('INSERT INTO events')) return false
    seen += 1
    return seen > after
  }
  return {
    query: (text, params) =>
      fail(text) ? Promise.reject(new Error('the write failed')) : db.query(text, params),
    exec: (text) => db.exec(text),
    transaction: (fn) => db.transaction((tx) => fn(crashing(tx, after))),
  }
}
