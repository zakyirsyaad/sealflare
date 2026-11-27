import type { TrustTier } from '@sealflare/shared/rules'
import type { TargetDetail } from '@sealflare/shared/schemas'
import { copy } from './copy'

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
/** An address is shortened, the name of a repository is not. */
export function targetLabel(label: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(label) ? shortAddress(label) : label
}
/** A list in words: "a, b or c". */
export function listWithOr(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] as string
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1] as string}`
}
export function formatBnb(wei: string | bigint): string {
  if (!/^\d+$/.test(String(wei))) throw new RangeError('Wei must be a non-negative integer.')
  const amount = BigInt(wei)
  const whole = amount / 10n ** 18n
  const fraction = (amount % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}
export function timeLeft(until: Date, now: Date): string {
  const diff = until.getTime() - now.getTime()
  if (!Number.isFinite(diff)) throw new RangeError('A valid date is required.')
  const minutes = Math.max(0, Math.ceil(diff / 60000))
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
/** A transaction hash that stands for nothing, used when the event log could not be read. */
export function isZeroHash(hash: string): boolean {
  return /^0x0{64}$/.test(hash)
}
export function verdictLabel(verdict: 'SAFE' | 'CAUTION' | 'DANGER'): string {
  return copy.attest[verdict === 'SAFE' ? 'safe' : verdict === 'CAUTION' ? 'caution' : 'danger']
}
export function formatUtc(seconds: number | bigint): string {
  const date = new Date(Number(seconds) * 1000)
  if (Number.isNaN(date.getTime())) throw new RangeError('A valid timestamp is required.')
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}
/** An ISO date as the day and the time in UTC. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) throw new RangeError('A valid date is required.')
  return formatUtc(Math.floor(date.getTime() / 1000))
}
export function tierLabel(tier: TrustTier): string {
  const entry = copy.tiers[tier]
  if (!entry) throw new RangeError('Unknown trust tier.')
  return entry.label
}
export function tierReason(detail: Pick<TargetDetail, 'tier' | 'hasDelegatecall'>): string {
  if (detail.tier === 'CAUTION_FLAGGED' && detail.hasDelegatecall) return copy.target.proxyReason
  const entry = copy.tiers[detail.tier]
  if (!entry) throw new RangeError('Unknown trust tier.')
  return entry.reason
}
/**
 * How long ago a moment was, in words.
 *
 * The list shows when the last vote came, so a reader knows how old a row is without reading
 * a number.
 */
export function timeAgo(iso: string, now: Date): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) throw new RangeError('A valid date is required.')
  const minutes = Math.floor((now.getTime() - then) / 60000)
  if (minutes < 1) return copy.explore.justNow
  if (minutes < 60) return copy.explore.minutesAgo.replace('{count}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return copy.explore.hoursAgo.replace('{count}', String(hours))
  const days = Math.floor(hours / 24)
  if (days < 2) return copy.explore.yesterday
  return copy.explore.daysAgo.replace('{count}', String(days))
}
/** A flag name in words: HIDDEN_MINT becomes "Hidden mint". */
export function flagLabel(name: string): string {
  const words = name.toLowerCase().split('_')
  const first = words[0] ?? ''
  const head = `${first.charAt(0).toUpperCase()}${first.slice(1)}`
  return [head, ...words.slice(1)].join(' ')
}
