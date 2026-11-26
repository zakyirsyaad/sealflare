import { expect, test } from 'vitest'
import type { Db } from '@sealflare/internal/db'
import {
  account,
  activeChallengeOf,
  addresses,
  applyVerdict,
  attest,
  chainClient,
  commitVote,
  createBounty,
  createTestDb,
  distribute,
  markDisputed,
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

/** The Core alone, which is what a database of an older build read. */
const coreOnly = () => ({ core: all().core })

const FIRST = targetAddress(0xa1)
const SECOND = targetAddress(0xa2)
const THIRD = targetAddress(0xa3)
const FOURTH = targetAddress(0xa4)
const FIFTH = targetAddress(0xa5)
const SIXTH = targetAddress(0xa6)
const SEVENTH = targetAddress(0xa7)

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

test('a database that read the Core alone fills the bounty when the Vault is read too', async () => {
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: SIXTH })
  await createBounty({ from: 5, targetId: targetIdOf(SIXTH), slots: 3 })
  await attest({ from: 2, contract: SIXTH })
  await attest({ from: 3, contract: SIXTH })
  await attest({ from: 4, contract: SIXTH })

  // The first run reads the Core alone, so the bounty of the Vault is not read yet.
  await indexOnce({ client: chainClient(), sql: db, addresses: coreOnly() })
  expect(await db.query('SELECT id FROM bounties')).toHaveLength(0)

  // The second run reads the Vault too. The Core events are in the raw log already, so their
  // handlers are skipped and the votes that came after the bounty are never offered to it.
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const fillers = await db.query<{ guardian: string }>(
    'SELECT guardian FROM bounty_fillers WHERE bounty_id = (SELECT id FROM bounties WHERE requester = $1)',
    [account(5).address.toLowerCase()],
  )
  expect(fillers.map((row) => row.guardian).sort()).toEqual(
    [account(2), account(3), account(4)].map((who) => who.address.toLowerCase()).sort(),
  )
  await close()
})

test('the moment of a verdict is filled when the chain is read again', async () => {
  const { db, close } = await createTestDb()
  const targetId = targetIdOf(SEVENTH)
  await attest({ from: 0, contract: SEVENTH, verdict: 2, flags: 1 })
  await markDisputed({ from: 0, targetId, challengeId: 99n })
  await applyVerdict({ from: 0, targetId, challengeId: 99n, outcome: 1, flags: 4 })

  await indexOnce({ client: chainClient(), sql: db, addresses: coreOnly() })
  // A database that was built before the columns existed has the verdict in its log and nothing
  // in its columns.
  await db.query('UPDATE targets SET verdict_at = NULL, count_at_verdict = NULL WHERE target_id = $1', [
    targetId,
  ])
  expect(await db.query('SELECT verdict_at FROM targets WHERE target_id = $1', [targetId])).toEqual([
    { verdict_at: null },
  ])

  // The chain is read again from the start block, and the moment is filled from the log.
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const rows = await db.query<{ verdict_at: Date | null; count_at_verdict: number | null }>(
    'SELECT verdict_at, count_at_verdict FROM targets WHERE target_id = $1',
    [targetId],
  )
  expect(rows[0]?.verdict_at).not.toBeNull()
  expect(rows[0]?.count_at_verdict).toBe(1)
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
