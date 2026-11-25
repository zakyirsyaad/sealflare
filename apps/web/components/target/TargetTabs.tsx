import type { AttestationRow, ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { Tabs } from '../ui/Tabs'
import { AttestationsTab } from './AttestationsTab'
import { FindingsTab } from './FindingsTab'
import { HistoryTab } from './HistoryTab'
import { copy } from '../../lib/copy'

export type TargetTabsProps = {
  detail: TargetDetail
  rows: readonly AttestationRow[]
  scan: ScanReport | null
  evidenceFailed?: boolean
}

function publisherContent(detail: TargetDetail) {
  if (detail.publisherRole === 'NONE') return <p className="sf-tab__empty">{copy.target.noPublisher}</p>
  const role = detail.publisherRole === 'VERIFIED_PUBLISHER' ? copy.publish.verifiedPublisher : copy.publish.sponsor
  return (
    <div className="sf-tab__facts">
      <p>{role}</p>
      <p className="sf-mono">{detail.bond} wei</p>
    </div>
  )
}

function disputeContent(detail: TargetDetail) {
  if (detail.activeChallengeId === null) return <p className="sf-tab__empty">{copy.target.noDisputes}</p>
  return <p>{copy.target.challengeOpen.replace('{id}', detail.activeChallengeId)}</p>
}

/** The details of a target. The findings open first. */
export function TargetTabs({ detail, rows, scan, evidenceFailed = false }: TargetTabsProps) {
  const items = [
    { id: 'findings', label: copy.target.findings, content: <FindingsTab scan={scan} /> },
    {
      id: 'attestations',
      label: copy.target.attestationCount.replace('{count}', String(rows.length)),
      content: <AttestationsTab rows={rows} evidenceUnavailable={evidenceFailed} />,
    },
    { id: 'publisher', label: copy.target.publisher, content: publisherContent(detail) },
    { id: 'dispute', label: copy.target.dispute, content: disputeContent(detail) },
    { id: 'bounty', label: copy.target.bounty, content: <p className="sf-tab__empty">{copy.target.noBounty}</p> },
    { id: 'history', label: copy.target.history, content: <HistoryTab rows={rows} /> },
  ]
  return <Tabs label={copy.target.findings} items={items} />
}
