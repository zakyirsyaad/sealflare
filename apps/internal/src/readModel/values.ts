/**
 * The values Postgres hands back, and the shapes the read model needs them in.
 *
 * A driver can hand a number back as a bigint, a number or a string, and a jsonb column as an
 * object or as text. These helpers turn every one of those into the one shape the read model
 * uses, so a route never has to care which driver it runs on.
 */

/** A whole number as a decimal string, whatever the driver handed back. */
export function decimalString(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return BigInt(Math.trunc(value)).toString()
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  throw new Error(`the value ${String(value)} is not a whole number`)
}

/** A timestamp as an ISO string, whatever the driver handed back. */
export function isoDate(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('the timestamp cannot be read')
  return date.toISOString()
}

/** Postgres and PGlite hand a jsonb column back as an object, but a driver may hand back text. */
export function jsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
