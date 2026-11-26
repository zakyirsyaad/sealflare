import type { TrustTier } from '@sealflare/shared/rules'
import { copy } from '../../lib/copy'
import { tierLabel } from '../../lib/format'

/**
 * The seal of a target.
 *
 * A small seal in a list has no room for the word inside it, so `showLabel` takes the word
 * out of the mark and leaves it to the text beside it. The mark still says what it is to a
 * reader of the screen.
 */
export function SealMark({ tier, size = 64, showLabel = true }: { tier: TrustTier; size?: number; showLabel?: boolean }) {
  const closed = tier === 'COMMUNITY_SAFE' || tier === 'WARRANTY_BACKED_SAFE'
  const variant = closed ? 'sealed' : tier === 'CONFIRMED_DANGER' ? 'broken' : tier === 'UNRATED' ? 'empty' : 'caution'
  return <svg className={`sf-seal sf-seal--${variant}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={tierLabel(tier)}>
    <circle className="sf-seal__track" cx="32" cy="32" r="26" strokeWidth="2" />
    <circle className="sf-seal__arc" cx="32" cy="32" r="26" strokeWidth="4" pathLength="100" strokeDasharray={closed ? undefined : tier === 'UNRATED' ? '3 4' : '76 24'} transform="rotate(-90 32 32)" data-closed={closed} />
    {showLabel && <text x="32" y="35" textAnchor="middle" className="sf-seal__label">{closed ? copy.common.safe : tier === 'CONFIRMED_DANGER' ? copy.common.danger : tier === 'UNRATED' ? copy.common.unrated : copy.common.caution}</text>}
  </svg>
}
