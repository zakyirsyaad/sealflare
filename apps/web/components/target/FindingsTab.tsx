import type { ScanReport } from '@sealflare/shared/schemas'
import { Chip } from '../ui/Chip'
import { copy } from '../../lib/copy'
import { flagLabel } from '../../lib/format'

export type FindingsTabProps = { scan: ScanReport | null }

/** The state of a check in one word. A check that did not run is never a pass. */
function stateWord(status: 'passed' | 'flagged' | 'skipped' | 'failed'): string {
  return copy.target.states[status]
}

/** The findings of the last scan, one row per check and per finding. */
export function FindingsTab({ scan }: FindingsTabProps) {
  if (scan === null) return <p className="sf-tab__empty">{copy.target.noScan}</p>
  return (
    <ul className="sf-findings">
      {scan.checks.map(check => (
        <li key={check.id} className="sf-finding" data-status={check.status}>
          <span className={`sf-finding__state sf-finding__state--${check.status}`}>{stateWord(check.status)}</span>
          <div className="sf-finding__body">
            <div className="sf-finding__title">{copy.target.checks[check.id]}</div>
            {check.detail !== undefined && <div className="sf-finding__note">{check.detail}</div>}
          </div>
        </li>
      ))}
      {scan.findings.map(finding => (
        <li key={`${finding.checkId}-${finding.flag}-${finding.location}`} className="sf-finding" data-status="reported">
          <span className="sf-finding__state sf-finding__state--reported">{copy.target.states.reported}</span>
          <div className="sf-finding__body">
            <div className="sf-finding__title">{finding.title}</div>
            <div className="sf-finding__proof">{finding.excerpt}</div>
          </div>
          <Chip className="sf-chip--flag sf-chip--danger">{flagLabel(finding.flag)}</Chip>
        </li>
      ))}
    </ul>
  )
}
