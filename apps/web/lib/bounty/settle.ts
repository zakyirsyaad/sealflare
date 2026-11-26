import { CONSTANTS } from '@sealflare/shared/rules'
import type { BountySummary } from '@sealflare/shared/schemas'
import { formatBnb } from '../format'

/**
 * The numbers of a bounty, read from the constants of the contracts.
 *
 * The bounds of the slots and of the amount are never written out in the interface, so the
 * interface cannot drift away from the contract.
 */

/** The number of slots a bounty may have. */
export const SLOT_RANGE = { min: CONSTANTS.BOUNTY_MIN_SLOTS, max: CONSTANTS.BOUNTY_MAX_SLOTS } as const

/** The slots a bounty may have, as the list to choose from. */
export function slotChoices(): number[] {
  const count = SLOT_RANGE.max - SLOT_RANGE.min + 1
  return Array.from({ length: count }, (_, index) => SLOT_RANGE.min + index)
}

/** The most a bounty may hold, as BNB. */
export function bountyCap(): string {
  return formatBnb(CONSTANTS.MAX_BOUNTY)
}

/** The share of the payout that goes to the treasury, in percent. */
export function treasuryShare(): number {
  return CONSTANTS.BOUNTY_FEE_BPS / 100
}

/** How long a slot that stays empty waits before the money comes back, in days. */
export function refundDays(): number {
  return CONSTANTS.BOUNTY_TIMEOUT / 86_400
}

/** The bounties the app knows about, reduced to what the settle window needs. */
export type SettleWindow = Pick<BountySummary, 'createdAt' | 'settleableAt' | 'settled' | 'slots' | 'filled'>

/**
 * The moment a bounty can be settled at the earliest.
 *
 * The contract settles every bounty seven days after it was created, whatever its slots hold. A
 * bounty with all its slots filled waits 48 hours after the last slot, and the indexer writes
 * that moment as the moment of the bounty, the earlier of the two.
 *
 * The 48 hours only ever apply to a bounty whose slots are full, so the moment of the indexer is
 * only trusted for a full bounty. A bounty that is still missing slots, and a full bounty whose
 * moment the indexer did not write, are settled seven days after they were created, the same
 * rule the contract uses. A settled bounty has no moment left: it is paid out already.
 */
export function settleAtOf(bounty: SettleWindow): Date | null {
  if (bounty.settled) return null
  const created = new Date(bounty.createdAt)
  if (Number.isNaN(created.getTime())) return null
  const deadline = new Date(created.getTime() + CONSTANTS.BOUNTY_TIMEOUT * 1000)
  if (bounty.filled < bounty.slots) return deadline
  const at = bounty.settleableAt === null ? null : new Date(bounty.settleableAt)
  if (at === null || Number.isNaN(at.getTime())) return deadline
  // The contract settles a bounty seven days after it was created, whatever the indexer says.
  return new Date(Math.min(at.getTime(), deadline.getTime()))
}

/**
 * Whether a bounty may be funded with these slots and this amount.
 *
 * The bounds are the ones of the contract, and they are checked here as well as in the panel, so
 * that a write can never leave the app with a bounty the vault will refuse.
 */
export function withinBountyBounds(slots: number, amount: bigint): boolean {
  if (slots < SLOT_RANGE.min || slots > SLOT_RANGE.max) return false
  if (amount <= 0n || amount > CONSTANTS.MAX_BOUNTY) return false
  return true
}

/**
 * Whether a bounty can be settled at the given moment.
 *
 * The moment is passed in, so the answer never depends on the clock of the browser. The caller
 * reads the time of the chain, which is the clock the contract compares against.
 */
export function canSettle(bounty: SettleWindow, now: Date): boolean {
  const at = settleAtOf(bounty)
  if (at === null) return false
  if (Number.isNaN(now.getTime())) return false
  return now.getTime() >= at.getTime()
}
