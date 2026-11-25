import type { TargetDetail } from '@sealflare/shared/schemas'
import { SealMark } from '../ui/SealMark'
import { SignalBreakdown } from './SignalBreakdown'
import { copy } from '../../lib/copy'
import { shortAddress, tierLabel, tierReason } from '../../lib/format'

export type StatusCardProps = { detail: TargetDetail }

function publisherFact(detail: TargetDetail): { title: string; note: string } {
  if (detail.publisherRole === 'NONE') return { title: copy.target.notClaimed, note: copy.target.noBond }
  const title = detail.publisherRole === 'VERIFIED_PUBLISHER' ? copy.publish.verifiedPublisher : copy.publish.sponsor
  return { title, note: detail.bond === '0' ? copy.target.noBond : `${detail.bond} wei` }
}

/** The tier in words, the reason behind it and the signal that produced it. */
export function StatusCard({ detail }: StatusCardProps) {
  const publisher = publisherFact(detail)
  return (
    <section className="sf-status sf-frame" aria-label={copy.target.communitySignal}>
      <div className="sf-status__head">
        <SealMark tier={detail.tier} size={76} />
        <div className="sf-status__words">
          <h2>{tierLabel(detail.tier)}</h2>
          <p className="sf-status__reason">{tierReason(detail)}</p>
        </div>
      </div>
      <div className="sf-status__facts">
        <div className="sf-status__fact">
          <span className="sf-mono sf-status__fact-label">{copy.target.codehash}</span>
          <span className="sf-mono">{shortAddress(detail.pinnedCodehash)}</span>
        </div>
        <div className="sf-status__fact">
          <span className="sf-mono sf-status__fact-label">{copy.target.publisher}</span>
          <span>{publisher.title}</span>
          <span className="sf-status__fact-note">{publisher.note}</span>
        </div>
        <div className="sf-status__fact">
          <span className="sf-mono sf-status__fact-label">{copy.target.dispute}</span>
          <span>{detail.activeChallengeId === null ? copy.target.noneOpen : copy.target.challengeOpen.replace('{id}', detail.activeChallengeId)}</span>
          {detail.activeChallengeId === null && <span className="sf-status__fact-note">{copy.target.noPastChallenges}</span>}
        </div>
      </div>
      <div className="sf-status__signal">
        <h3 className="sf-mono">{copy.target.communitySignal}</h3>
        <SignalBreakdown signal={detail.signal} />
      </div>
    </section>
  )
}
