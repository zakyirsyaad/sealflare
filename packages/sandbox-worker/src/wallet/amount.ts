/** Unsigned decimal amounts and hexadecimal integers, in the same units as the user intent. */
export function parseAmount(value: unknown): { units: bigint; scale: number } | null {
  if (typeof value !== 'string' || value.length > 256) return null
  const text = value.trim()
  if (/^0x[0-9a-f]+$/i.test(text)) return { units: BigInt(text), scale: 0 }
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  let units = BigInt(`${whole}${fraction}`), scale = fraction.length
  while (scale > 0 && units % 10n === 0n) { units /= 10n; scale-- }
  return { units, scale }
}

export function compareAmounts(left: unknown, right: unknown): number | null {
  const a = parseAmount(left), b = parseAmount(right)
  if (!a || !b) return null
  const scale = Math.max(a.scale, b.scale)
  const difference = a.units * 10n ** BigInt(scale - a.scale) - b.units * 10n ** BigInt(scale - b.scale)
  return difference > 0n ? 1 : difference < 0n ? -1 : 0
}

export function amountKey(value: string): string {
  const amount = parseAmount(value)
  return amount ? `${amount.units}:${amount.scale}` : value.trim().toLowerCase()
}

const UNLIMITED_FLOOR = (2n ** 255n).toString()
const UNLIMITED_WORDS = ['max', 'unlimited', 'infinite', 'max_uint256', 'uint256 max', '2**256-1', '1e77']

export function isUnlimited(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return UNLIMITED_WORDS.includes(value.trim().toLowerCase()) || (compareAmounts(value, UNLIMITED_FLOOR) ?? -1) >= 0
}
