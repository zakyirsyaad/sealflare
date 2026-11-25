'use client'
import { useRef, useState } from 'react'
import { FLAGS, FLAG_NAMES, type FlagName, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { flagLabel, verdictLabel } from '../../lib/format'
import { pickableVerdicts } from './availability'
import { flagsOf, missingQuotes, type Choice } from './choice'

export type VerdictStepProps = {
  choice: Choice
  /** The flags of the scanner, as a bit mask. */
  scanFlags: number
  /** The flags whose excerpt travels with the report. Every other flag needs a quote. */
  provedFlags: number
  /** What the scanner proposes. It is never chosen before the Guardian chooses it. */
  suggestion: Verdict | null
  tier: TrustTier
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  canContinue: boolean
  onChoose: (verdict: Verdict) => void
  onAddFlag: (flag: FlagName) => void
  onRemoveFlag: (flag: FlagName) => void
  onQuote: (flag: FlagName, quote: string) => void
  onContinue: () => void
}

const help: Record<Verdict, string> = {
  SAFE: copy.attest.safeHelp,
  CAUTION: copy.attest.cautionHelp,
  DANGER: copy.attest.dangerHelp,
}

const label: Record<Verdict, string> = {
  SAFE: copy.attest.safe,
  CAUTION: copy.attest.caution,
  DANGER: copy.attest.danger,
}

/** The flags of this kind of target. A contract never carries a skill flag, and the other way round. */
function flagsOfType(targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'): FlagName[] {
  const mask = targetType === 'SMART_CONTRACT' ? 0x00ff : 0xff00
  return FLAG_NAMES.filter(name => (FLAGS[name] & mask) !== 0)
}

/**
 * The first step: the Guardian picks a verdict and the flags that come with it.
 *
 * The scanner only suggests. Nothing is chosen before the Guardian chooses it, and the suggested
 * verdict is named but never filled in.
 */
export function VerdictStep(props: VerdictStepProps) {
  const [adding, setAdding] = useState(false)
  const { choice } = props
  const pickable = pickableVerdicts(props.tier)
  const chosen = flagsOf(choice)
  const waiting = missingQuotes(choice, props.provedFlags)
  // Every flag whose excerpt does not travel with the report carries a quote of the Guardian.
  // The field stays on the screen once it has a quote, so the Guardian can correct it.
  const needsQuote = flagsOf(choice).filter(name => (props.provedFlags & FLAGS[name]) === 0)
  const options: Verdict[] = ['SAFE', 'CAUTION', 'DANGER']
  const available = flagsOfType(props.targetType).filter(name => !chosen.includes(name))
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})
  const pickableOptions = options.filter(verdict => pickable[verdict])

  /** The arrow keys move the choice, as a radio group does. */
  const move = (from: Verdict, step: number) => {
    const index = pickableOptions.indexOf(from)
    if (index < 0) return
    const next = pickableOptions[(index + step + pickableOptions.length) % pickableOptions.length]
    if (next === undefined) return
    props.onChoose(next)
    buttons.current[next]?.focus()
  }

  return (
    <>
      <section className="sf-stack">
        <p className="sf-lead">{copy.attest.twoApprovals}</p>
        {props.suggestion !== null && (
          <p className="sf-lead">{copy.attest.suggestion.replace('{verdict}', verdictLabel(props.suggestion))}</p>
        )}
      </section>
      <section role="radiogroup" aria-label={copy.attest.yourVerdict} className="sf-stack">
        {options.map(verdict => (
          <button
            key={verdict}
            type="button"
            role="radio"
            aria-checked={choice.verdict === verdict}
            className="sf-opt"
            disabled={!pickable[verdict]}
            tabIndex={choice.verdict === verdict || (choice.verdict === null && verdict === pickableOptions[0]) ? 0 : -1}
            ref={element => {
              buttons.current[verdict] = element
            }}
            onClick={() => props.onChoose(verdict)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') move(verdict, 1)
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') move(verdict, -1)
            }}
          >
            <span aria-hidden="true" className="sf-opt__marker" />
            <span>
              <span className="sf-opt__title">
                {label[verdict]}
                {props.suggestion === verdict && <span className="sf-mono"> {copy.attest.suggested}</span>}
              </span>
              <span className="sf-opt__help">{help[verdict]}</span>
            </span>
          </button>
        ))}
        {props.tier === 'CONFIRMED_DANGER' && <p className="sf-lead">{copy.attest.dangerSafe}</p>}
      </section>
      <section className="sf-stack">
        <span className="sf-mono">{copy.attest.flagsTitle}</span>
        <div className="sf-flags">
          {chosen.map(name => (
            <span key={name} className="sf-chip sf-chip--flag">
              {flagLabel(name)}
              <button
                type="button"
                className="sf-chip__remove"
                aria-label={`${copy.attest.removeFlag} ${flagLabel(name)}`}
                onClick={() => props.onRemoveFlag(name)}
              >
                {copy.attest.removeFlag}
              </button>
            </span>
          ))}
          <Button variant="secondary" onClick={() => setAdding(open => !open)}>
            {copy.attest.addFlag}
          </Button>
        </div>
        {adding && (
          <ul className="sf-flaglist" aria-label={copy.attest.flagChoice}>
            {available.map(name => (
              <li key={name}>
                <button type="button" className="sf-btn sf-btn--ghost" onClick={() => props.onAddFlag(name)}>
                  {flagLabel(name)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {choice.verdict !== null && choice.verdict !== 'SAFE' && choice.flags === 0 && (
          <p className="sf-lead">{copy.attest.needFlag}</p>
        )}
        {choice.verdict !== null && choice.verdict !== 'SAFE' && props.scanFlags === 0 && (
          <p className="sf-lead">{copy.attest.noScanFlags}</p>
        )}
      </section>
      {needsQuote.map(name => (
        <section key={name} className="sf-stack">
          <label className="sf-opt__title" htmlFor={`quote-${name}`}>
            {copy.attest.quoteFor.replace('{flag}', flagLabel(name))}
          </label>
          {waiting.includes(name) && <p className="sf-lead">{copy.attest.quoteHint}</p>}
          <input
            id={`quote-${name}`}
            className="sf-input"
            value={choice.quotes[name] ?? ''}
            onChange={event => props.onQuote(name, event.target.value)}
          />
        </section>
      ))}
      <footer className="sf-panel__footer">
        <Button variant="primary" disabled={!props.canContinue} onClick={props.onContinue}>
          {copy.attest.review}
        </Button>
      </footer>
    </>
  )
}
