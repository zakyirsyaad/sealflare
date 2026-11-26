import { CONSTANTS } from '@sealflare/shared/rules'
import { formatBnb } from '../format'

/** The bond of one depositor, as the vault holds it. */
export type PublisherBond = {
  /** Wei, decimal integer string. */
  amount: string
  /** The second the bond becomes withdrawable, null when no withdrawal was requested. */
  withdrawalAvailableAt: number | null
  /** The challenge that locks the bond, null when it is free. */
  lockedByChallengeId: string | null
}

/**
 * The numbers of the warranty bond, read from the constants of the contracts. They are never
 * written out in the interface.
 */
export function bondTerms(): { cap: string; days: number; slash: string; responseHours: number } {
  const bps = CONSTANTS.BOND_SLASH_BPS
  return {
    cap: formatBnb(CONSTANTS.MAX_WARRANTY_BOND),
    days: CONSTANTS.BOND_UNBONDING / 86_400,
    slash: bps === 5000 ? 'Half' : `${bps / 100}%`,
    responseHours: CONSTANTS.COMMIT_WINDOW / 3600,
  }
}

/** The smallest and the largest bond the vault accepts, in wei. */
export function bondRange(): { min: bigint; max: bigint } {
  return { min: 1n, max: CONSTANTS.MAX_WARRANTY_BOND }
}

/** Reads an amount in BNB as wei. A decimal string never becomes a floating point number. */
export function parseBnb(value: string): bigint | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}
