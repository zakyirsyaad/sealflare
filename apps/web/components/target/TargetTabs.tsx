import type { AttestationRow, ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { Tabs } from '../ui/Tabs'
import { AttestationsTab } from './AttestationsTab'
import { FindingsTab } from './FindingsTab'
import { HistoryTab } from './HistoryTab'
import { PublisherTab } from './PublisherTab'
import { copy } from '../../lib/copy'
import type { Binding } from '../../lib/publish/binding'
import type { PublisherBond } from '../../lib/publish/bond'
import type { SandboxSource } from '../../lib/sandbox/source'

export type TargetTabsProps = {
  detail: TargetDetail
  rows: readonly AttestationRow[]
  scan: ScanReport | null
  evidenceFailed?: boolean
  /** How the target was bound, read from the event log of Core. */
  binding?: Binding | null
  /** The bond of the publisher, as the vault holds it. */
  publisherBond?: PublisherBond | null
  /** The bundle the sandbox can run on, or null when this target has none. */
  sandbox?: SandboxSource | null
}

function disputeContent(detail: TargetDetail) {
  if (detail.activeChallengeId === null) return <p className="sf-tab__empty">{copy.target.noDisputes}</p>
  return <p>{copy.target.challengeOpen.replace('{id}', detail.activeChallengeId)}</p>
}

/** The details of a target. The findings open first. */
export function TargetTabs({
  detail,
  rows,
  scan,
  evidenceFailed = false,
  binding = null,
  publisherBond = null,
  sandbox = null,
}: TargetTabsProps) {
  const items = [
    {
      id: 'findings',
      label: copy.target.findings,
      content: (
        <FindingsTab
          scan={scan}
          targetType={detail.targetType}
          src={sandbox?.src ?? null}
          bundleHash={sandbox?.bundleHash ?? null}
          sandbox={detail.sandbox}
        />
      ),
    },
    {
      id: 'attestations',
      label: copy.target.attestationCount.replace('{count}', String(rows.length)),
      content: <AttestationsTab rows={rows} evidenceUnavailable={evidenceFailed} />,
    },
    {
      id: 'publisher',
      label: copy.target.publisher,
      content: (
        <PublisherTab
          targetId={detail.targetId}
          role={detail.publisherRole}
          publisher={detail.publisher}
          method={binding?.method ?? null}
          bond={publisherBond}
        />
      ),
    },
    { id: 'dispute', label: copy.target.dispute, content: disputeContent(detail) },
    { id: 'bounty', label: copy.target.bounty, content: <p className="sf-tab__empty">{copy.target.noBounty}</p> },
    { id: 'history', label: copy.target.history, content: <HistoryTab rows={rows} /> },
  ]
  return <Tabs label={copy.target.findings} items={items} />
}
