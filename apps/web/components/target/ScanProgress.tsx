'use client'
import { copy } from '../../lib/copy'

export type CheckState = 'pending' | 'running' | 'done' | 'passed' | 'flagged' | 'skipped' | 'failed'

export type ScanProgressProps = {
  /** The check ids of this target type, in the order the scanner runs them. */
  checks: readonly string[]
  /** How many checks have finished. The check after the last one is running. */
  done: number
  /** The real result, once the scanner answered. */
  results?: readonly { id: string; status: 'passed' | 'flagged' | 'skipped' | 'failed' }[]
}

function stateOf(id: string, index: number, done: number, results?: ScanProgressProps['results']): CheckState {
  const found = results?.find(result => result.id === id)
  if (found) return found.status
  if (index < done) return 'done'
  if (index === done) return 'running'
  return 'pending'
}

const MARK: Record<CheckState, string> = {
  pending: '○',
  running: '◐',
  done: '●',
  passed: '●',
  flagged: '▲',
  skipped: '–',
  failed: '×',
}

/** The Layer 1 checklist. It ticks off one check at a time while the scan runs. */
export function ScanProgress({ checks, done, results }: ScanProgressProps) {
  return (
    <ol className="sf-checks" aria-label={copy.scan.checklist}>
      {checks.map((id, index) => {
        const state = stateOf(id, index, done, results)
        return (
          <li key={id} className="sf-check" data-status={state}>
            <span className="sf-check__mark" aria-hidden="true">{MARK[state]}</span>
            <span className="sf-check__id mono">{id}</span>
            <span className="sf-sr-only">{state}</span>
          </li>
        )
      })}
    </ol>
  )
}
