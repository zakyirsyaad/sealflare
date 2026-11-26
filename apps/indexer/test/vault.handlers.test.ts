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
  depositBond,
  distribute,
  openChallenge,
  requestBondWithdrawal,
  sponsor,
  targetAddress,
  targetIdOf,
  withdraw,
} from './helpers'
import { indexOnce } from '../src/loop'

/**
 * The Vault rows the indexer writes.
 *
 * The chain is shared by the whole run, so every test uses a target of its own.
 */

const all = () => {
  const found = addresses()
  return { core: found.core, court: found.court, vault: found.vault }
}

test('a balance is the sum of the credits minus the withdrawals', async () => {
  const target = targetAddress(0x91)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await commitVote({ from: 2, challengeId: id, value: 1000n })

  // The chain is shared by the whole run, so the balance before the payout is read first.
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })
  const before = BigInt(await balanceOf(db, account(5).address))

  await distribute({
    from: 3,
    challengeId: id,
    recipients: [account(4).address, account(5).address],
    amounts: [400n, 600n],
  })
  await withdraw({ from: 4 })
  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  // The account that took its money out has nothing left, and the other one has the payout.
  expect(await balanceOf(db, account(4).address)).toBe('0')
  expect(await balanceOf(db, account(5).address)).toBe((before + 600n).toString())
  await close()
})

/** The balance of an account, as the ledger of that account adds up. */
async function balanceOf(db: Db, address: string): Promise<string> {
  const rows = await db.query<{ balance: string }>(
    `SELECT sum(CASE WHEN kind = 'CREDIT' THEN amount ELSE -amount END)::text AS balance
     FROM balances WHERE address = $1`,
    [address.toLowerCase()],
  )
  return rows[0]?.balance ?? '0'
}

test('the payouts of a challenge are the rows of that challenge alone', async () => {
  const first = targetAddress(0x92)
  const second = targetAddress(0x93)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: first })
  await attest({ from: 0, contract: second })
  await openChallenge({ from: 1, targetId: targetIdOf(first) })
  await openChallenge({ from: 1, targetId: targetIdOf(second) })
  const firstId = await activeChallengeOf(targetIdOf(first))
  const secondId = await activeChallengeOf(targetIdOf(second))
  await commitVote({ from: 2, challengeId: firstId, value: 1000n })
  await commitVote({ from: 2, challengeId: secondId, value: 1000n })
  await distribute({ from: 3, challengeId: firstId, recipients: [account(4).address], amounts: [100n] })
  await distribute({ from: 3, challengeId: secondId, recipients: [account(5).address], amounts: [300n] })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const firstRows = await db.query<{ recipient: string; amount: string }>(
    'SELECT recipient, amount::text AS amount FROM payouts WHERE challenge_id = $1',
    [firstId.toString()],
  )
  expect(firstRows).toHaveLength(1)
  expect(firstRows[0]).toMatchObject({ recipient: account(4).address.toLowerCase(), amount: '100' })

  const secondRows = await db.query<{ recipient: string; amount: string }>(
    'SELECT recipient, amount::text AS amount FROM payouts WHERE challenge_id = $1',
    [secondId.toString()],
  )
  expect(secondRows).toHaveLength(1)
  expect(secondRows[0]).toMatchObject({ recipient: account(5).address.toLowerCase(), amount: '300' })
  await close()
})

test('the slots of a bounty skip the requester and stop at the slot count', async () => {
  const target = targetAddress(0x94)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await createBounty({ from: 1, targetId: targetIdOf(target), slots: 3 })
  // The vote of the requester never fills a slot of its own bounty.
  await attest({ from: 2, contract: target })
  await attest({ from: 1, contract: target })
  await attest({ from: 3, contract: target })
  await attest({ from: 4, contract: target })
  // The bounty is full now, so this vote fills nothing.
  await attest({ from: 5, contract: target })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  // The chain is shared by the whole run, so only the bounty of this test is read.
  const bounties = await db.query<Record<string, unknown>>(
    'SELECT * FROM bounties WHERE requester = $1',
    [account(1).address.toLowerCase()],
  )
  expect(bounties).toHaveLength(1)
  expect(bounties[0]).toMatchObject({ slots: 3, settled: false })

  const fillers = await db.query<{ guardian: string }>(
    'SELECT guardian FROM bounty_fillers WHERE bounty_id = $1 ORDER BY guardian',
    [bounties[0]?.id],
  )
  const guardians = fillers.map((row) => row.guardian)
  expect(guardians).toHaveLength(3)
  expect(guardians).not.toContain(account(1).address.toLowerCase())
  expect(guardians).not.toContain(account(5).address.toLowerCase())
  expect(guardians).toContain(account(2).address.toLowerCase())
  expect(guardians).toContain(account(3).address.toLowerCase())
  expect(guardians).toContain(account(4).address.toLowerCase())
  await close()
})

test('the escrow of a dispute is the sum of the movements of that dispute', async () => {
  const target = targetAddress(0x95)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await openChallenge({ from: 1, targetId: targetIdOf(target) })
  const id = await activeChallengeOf(targetIdOf(target))
  await commitVote({ from: 2, challengeId: id, value: 1000n })
  await distribute({ from: 3, challengeId: id, recipients: [account(4).address], amounts: [400n] })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const escrow = await db.query<{ total: string }>(
    'SELECT sum(delta)::text AS total FROM escrow_movements WHERE challenge_id = $1',
    [id.toString()],
  )
  expect(escrow[0]?.total).toBe('600')
  await close()
})

test('the bond of a target is the bond of its publisher of record', async () => {
  const target = targetAddress(0x96)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  // The publisher of record is the one that posted the bond.
  await sponsor({ from: 1, targetId: targetIdOf(target) })
  await depositBond({ from: 1, targetId: targetIdOf(target), value: 500n })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  const rows = await db.query<{ bond: string; publisher_role: string }>(
    'SELECT bond::text AS bond, publisher_role FROM targets WHERE src = $1',
    [target],
  )
  expect(rows[0]?.publisher_role).toBe('THIRD_PARTY_SPONSOR')
  expect(rows[0]?.bond).toBe('500')
  await close()
})

test('a bond that is being withdrawn does not count for the target', async () => {
  const target = targetAddress(0x97)
  const { db, close } = await createTestDb()
  await attest({ from: 0, contract: target })
  await sponsor({ from: 1, targetId: targetIdOf(target) })
  await depositBond({ from: 1, targetId: targetIdOf(target), value: 500n })
  await requestBondWithdrawal({ from: 1, targetId: targetIdOf(target) })

  await indexOnce({ client: chainClient(), sql: db, addresses: all() })

  // The bond is still slashable, but it does not count for the target any more.
  const rows = await db.query<{ bond: string }>('SELECT bond::text AS bond FROM targets WHERE src = $1', [target])
  expect(rows[0]?.bond).toBe('0')
  const bonds = await db.query<{ amount: string }>('SELECT amount::text AS amount FROM bonds WHERE target_id = $1', [
    targetIdOf(target),
  ])
  expect(bonds[0]?.amount).toBe('500')
  await close()
})
