'use client'
import { copy } from '../../lib/copy'

export type PublishKind = 'contract' | 'skill'

export type KindStepProps = {
  kind: PublishKind
  onKind: (kind: PublishKind) => void
}

/** The first question of the Publish screen: what is being bound. */
export function KindStep({ kind, onKind }: KindStepProps) {
  return (
    <div className="sf-seg" role="group" aria-label={copy.publish.kindLabel}>
      <button type="button" aria-pressed={kind === 'contract'} onClick={() => onKind('contract')}>
        {copy.publish.kindContract}
      </button>
      <button type="button" aria-pressed={kind === 'skill'} onClick={() => onKind('skill')}>
        {copy.publish.kindSkill}
      </button>
    </div>
  )
}
