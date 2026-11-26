import type { ProbeId, SandboxResult } from '@sealflare/shared/schemas'
import type { Quota, RunState } from '../../lib/api/client'
import { copy } from '../../lib/copy'
import { formatDate } from '../../lib/format'
import { Button } from '../ui/Button'

export type SandboxViewProps = {
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** The result the cache holds for this bundle, if there is one. */
  cached: SandboxResult | null
  /** The run that is going on, or the one that has ended. */
  run: RunState | null
  /** The sandbox is paused for the rest of the day. */
  paused: boolean
  /** The reason the last attempt failed. */
  error: string | null
  /** The runs the address has left today. */
  quota: Quota | null
  /** Why the button is closed, or null when a run can start. */
  blocked: string | null
  /** The run is being started or read. */
  busy: boolean
  onRun: () => void
}

/** The name of a probe in words. An unknown probe keeps its own name. */
function probeLabel(probe: ProbeId | undefined): string {
  if (probe === undefined) return copy.sandbox.stoppedEarly
  return copy.sandbox.probes[probe]
}

/** The tool calls the sandbox caught, grouped by the probe that caught them. */
function caughtCalls(result: SandboxResult): { probe: string; calls: { tool: string; rule: string }[] }[] {
  return result.probes
    .map(probe => ({
      probe: probeLabel(probe.probeId),
      calls: probe.runs.flatMap(run =>
        run.violations.map(violation => ({ tool: violation.tool, rule: violation.rule })),
      ),
    }))
    .filter(entry => entry.calls.length > 0)
}

/**
 * The result of a run that has ended.
 *
 * A clean result is never a proof of safety, and it says so. A run that stopped early shows what
 * it found and why it stopped, because a partial result says nothing about the rest of the skill.
 */
function ResultView({ result }: { result: SandboxResult }) {
  const caught = caughtCalls(result)
  return (
    <div className="sf-sandbox__result" data-status={result.status}>
      {result.status === 'NO_VIOLATION_OBSERVED' && (
        <>
          <p className="sf-sandbox__verdict">{copy.sandbox.noViolation}</p>
          <p className="sf-sandbox__meta">
            {copy.sandbox.modelAndDate.replace('{model}', result.modelId).replace('{date}', formatDate(result.finishedAt))}
          </p>
          <p className="sf-sandbox__note">{copy.sandbox.notProof}</p>
        </>
      )}
      {result.status === 'SANDBOX_FUZZ_FAILED' && (
        <>
          <p className="sf-sandbox__verdict">{copy.sandbox.caught}</p>
          <ul className="sf-sandbox__calls">
            {caught.map(entry => (
              <li key={entry.probe}>
                <span className="sf-mono">{entry.probe}</span>
                <ul>
                  {entry.calls.map(call => (
                    <li key={`${call.tool}-${call.rule}`}>
                      {copy.sandbox.call.replace('{tool}', call.tool).replace('{rule}', call.rule)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.status === 'INCOMPLETE' && (
        <>
          <p className="sf-sandbox__verdict">
            {copy.sandbox.incomplete.replace('{reason}', result.incompleteReason ?? copy.sandbox.stoppedEarly)}
          </p>
          {caught.length > 0 && (
            <ul className="sf-sandbox__calls">
              {caught.map(entry => (
                <li key={entry.probe}>
                  <span className="sf-mono">{entry.probe}</span>
                  <ul>
                    {entry.calls.map(call => (
                      <li key={`${call.tool}-${call.rule}`}>
                        {copy.sandbox.call.replace('{tool}', call.tool).replace('{rule}', call.rule)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          <p className="sf-sandbox__note">{copy.sandbox.notProof}</p>
        </>
      )}
    </div>
  )
}

/** The state of a run that has not ended yet. */
function RunView({ run }: { run: RunState }) {
  if (run.status === 'queued') {
    return <p className="sf-sandbox__state">{copy.sandbox.queued.replace('{position}', String(run.queuePosition ?? 1))}</p>
  }
  if (run.status === 'running') {
    return <p className="sf-sandbox__state">{copy.sandbox.running.replace('{probe}', probeLabel(run.currentProbe))}</p>
  }
  return <p className="sf-sandbox__state">{copy.sandbox.failed.replace('{reason}', copy.sandbox.noResult)}</p>
}

/** The button that starts a run, with the cost of one run and what is left of the quota. */
function StartView({ quota, blocked, busy, error, onRun }: SandboxViewProps) {
  return (
    <div className="sf-sandbox__start">
      <Button variant="primary" disabled={blocked !== null || busy} onClick={onRun}>
        {copy.sandbox.action}
      </Button>
      <p className="sf-sandbox__cost">{copy.sandbox.cost}</p>
      {quota !== null && (
        <p className="sf-mono sf-sandbox__quota">
          {copy.sandbox.quotaLeft.replace('{left}', String(quota.left)).replace('{limit}', String(quota.limit))}
        </p>
      )}
      {blocked !== null && <p className="sf-sandbox__reason">{blocked}</p>}
      {error !== null && <p className="sf-sandbox__reason">{error}</p>}
    </div>
  )
}

/**
 * The sandbox section of the target page.
 *
 * The section shows the result of the bundle when there is one, the state of the run while it goes
 * on, and the button when the bundle has never been run. A paused sandbox says so and offers no
 * button, because Layer 1 results are unaffected by the pause.
 */
export function SandboxView(props: SandboxViewProps) {
  const result = props.run?.result ?? props.cached
  return (
    <section className="sf-sandbox sf-frame" aria-label={copy.sandbox.title}>
      <h3 className="sf-mono">{copy.sandbox.title}</h3>
      {props.paused && <p className="sf-sandbox__paused">{copy.sandbox.paused}</p>}
      {props.targetType === 'SMART_CONTRACT' ? (
        <p className="sf-tab__empty">{copy.sandbox.notForContracts}</p>
      ) : result !== null ? (
        <ResultView result={result} />
      ) : props.run !== null ? (
        <RunView run={props.run} />
      ) : props.paused ? null : (
        <StartView {...props} />
      )}
    </section>
  )
}
