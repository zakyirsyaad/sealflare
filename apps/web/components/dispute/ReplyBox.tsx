'use client'
import { useState } from 'react'
import { Button } from '../ui/Button'
import type { ChallengePhase } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { evidenceHref } from '../../lib/evidenceLink'
import { timeLeft } from '../../lib/format'
import type { PublisherRole } from '../../server/disputes'
import { ReplyPanel } from './ReplyPanel'

export type ReplyBoxProps = {
  challengeId: string
  targetId: string
  phase: ChallengePhase | null
  /** What the registry says about the publisher. Null when it could not be read. */
  publisherRole: PublisherRole | null
  publisher: string | null
  counterEvidenceURI: string | null
  commitEndsAt: string
  now: Date
}

function Frame({ aside, children }: { aside?: string; children: React.ReactNode }) {
  return (
    <section className="sf-frame sf-evidence" aria-label={copy.dispute.reply}>
      <div className="sf-rows__row sf-evidence__head">
        <span className="sf-mono">{copy.dispute.reply}</span>
        {aside !== undefined && <span className="sf-mono">{aside}</span>}
      </div>
      <div className="sf-stack sf-evidence__body">{children}</div>
    </section>
  )
}

/** The reply that is already on the dispute, with its link. */
function Submitted({ uri }: { uri: string }) {
  const href = evidenceHref(uri)
  return (
    <Frame>
      <p className="sf-opt__title">{copy.dispute.replySubmitted}</p>
      {href === null ? (
        <p className="sf-lead">{copy.dispute.evidenceUnavailable}</p>
      ) : (
        <a href={href} target="_blank" rel="noreferrer">
          {copy.dispute.fullReply}
        </a>
      )}
    </Frame>
  )
}

/**
 * The reply of the publisher.
 *
 * Only the verified publisher of the target may reply, and only while jurors are still
 * committing. A sponsor has no button, and a target with no publisher has no countdown at all,
 * because nobody can ever reply.
 */
export function ReplyBox(props: ReplyBoxProps) {
  const user = useUserState()
  const [open, setOpen] = useState(false)
  if (props.counterEvidenceURI !== null) return <Submitted uri={props.counterEvidenceURI} />
  if (props.publisherRole === 'NONE') {
    return (
      <Frame>
        <p className="sf-opt__title">{copy.dispute.noPublisher}</p>
      </Frame>
    )
  }
  const committing = props.phase === 'COMMIT'
  const mine =
    'address' in user &&
    props.publisherRole === 'VERIFIED_PUBLISHER' &&
    props.publisher !== null &&
    props.publisher.toLowerCase() === user.address.toLowerCase()
  const closes = copy.dispute.replyCloses.replace('{time}', timeLeft(new Date(props.commitEndsAt), props.now))
  return (
    <Frame aside={committing ? closes : undefined}>
      <p className="sf-opt__title">{copy.dispute.noReplyYet}</p>
      {props.phase !== null && !committing && <p className="sf-lead">{copy.dispute.replyClosed}</p>}
      {committing && props.publisherRole === 'THIRD_PARTY_SPONSOR' && <p className="sf-lead">{copy.dispute.sponsorCannotReply}</p>}
      {committing && props.publisherRole !== 'THIRD_PARTY_SPONSOR' && <p className="sf-lead">{copy.dispute.replyHelp}</p>}
      {committing && mine && <Button onClick={() => setOpen(true)}>{copy.dispute.submitReply}</Button>}
      {open && <ReplyPanel challengeId={props.challengeId} targetId={props.targetId} onClose={() => setOpen(false)} />}
    </Frame>
  )
}
