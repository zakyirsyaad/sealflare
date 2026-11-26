import type { Address, Hex } from 'viem'
import type { Db } from '@sealflare/internal/db'
import { FatalIndexError } from '../fatal'

/**
 * The rows an event names, and the check that they are there.
 *
 * The indexer reads from `START_BLOCK` onwards, so a start block that is too late leaves out the
 * rows of the earlier events. The event then names a target, a guardian or a challenge the
 * database has never heard of, and the write would quietly change nothing. That would leave a
 * target looking unflagged and unconfirmed, so the indexer stops here and says what to fix.
 */

/** Stops the indexer when the row an event names is not in the database. */
export async function requireTarget(tx: Db, targetId: Hex, contract = 'event'): Promise<void> {
  const rows = await tx.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM targets WHERE target_id = $1) AS found',
    [targetId],
  )
  if (!rows[0]?.found) throw missingRow('target', targetId, contract)
}

export async function requireGuardian(tx: Db, guardian: Address, contract = 'event'): Promise<void> {
  const rows = await tx.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM guardians WHERE address = $1) AS found',
    [guardian.toLowerCase()],
  )
  if (!rows[0]?.found) throw missingRow('guardian', guardian.toLowerCase(), contract)
}

export async function requireChallenge(tx: Db, id: bigint, contract = 'event'): Promise<void> {
  const rows = await tx.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM challenges WHERE id = $1) AS found',
    [id.toString()],
  )
  if (!rows[0]?.found) throw missingRow('challenge', id.toString(), contract)
}

export async function requireBounty(tx: Db, id: bigint | string, contract = 'event'): Promise<void> {
  const rows = await tx.query<{ found: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM bounties WHERE id = $1) AS found',
    [id.toString()],
  )
  if (!rows[0]?.found) throw missingRow('bounty', id.toString(), contract)
}

/**
 * The event names a row the database does not have.
 *
 * Reading the same range again will not fix it, so the indexer stops with this error instead of
 * looping over the range. The message names the start block, and it says that a cursor wins over
 * it, because a database that has already read a range keeps the cursor of that range.
 */
export function missingRow(what: string, key: string, contract = 'event'): FatalIndexError {
  return new FatalIndexError(
    `The ${contract} event names the ${what} ${key}, which the database does not have. ` +
      `START_BLOCK must be at or before the block of the first ${contract} event. ` +
      `A cursor that already exists wins over START_BLOCK, so clear the cursor to read the range again.`,
  )
}

/**
 * The name a target is known by in the lists.
 *
 * The contract does not carry a name, so the label of the target is the label of every row that
 * points at it.
 */
/**
 * The label of a target Core may not have recorded yet, or null. A bounty can be asked for before
 * the target exists, and it takes its label when `TargetCreated` arrives.
 */
export async function labelOfKnownTarget(tx: Db, targetId: string): Promise<string | null> {
  const rows = await tx.query<{ label: string }>('SELECT label FROM targets WHERE target_id = $1', [targetId])
  return rows[0]?.label ?? null
}

export async function labelOfTarget(tx: Db, targetId: string): Promise<string> {
  const rows = await tx.query<{ label: string }>('SELECT label FROM targets WHERE target_id = $1', [targetId])
  const label = rows[0]?.label
  if (!label) throw new Error(`The target ${targetId} has no label.`)
  return label
}
