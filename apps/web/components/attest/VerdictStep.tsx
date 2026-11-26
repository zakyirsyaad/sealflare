'use client'
import { useRef, useState } from 'react'
import {
  CONTRACT_FLAGS_MASK,
  FLAGS,
  FLAG_NAMES,
  SKILL_FLAGS_MASK,
  type FlagName,
  type TargetType,
  type TrustTier,
  type Verdict,
} from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { flagLabel, verdictLabel } from '../../lib/format'
import { pickableVerdicts } from './availability'
import { flagsOf, missingQuotes, quoteLimit, type Choice } from './choice'

export type VerdictStepProps = {
  choice: Choice
  /** The flags of the scanner, as a bit mask. */
  scanFlags: number
  /** The flags whose excerpt travels with the report. Every other flag needs a quote. */
  provedFlags: number
  /** What the scanner proposes. It is never chosen before the Guardian chooses it. */
  suggestion: Verdict | null
  tier: TrustTier
  targetType: TargetType
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
function flagsOfType(targetType: TargetType): FlagName[] {
  const mask = targetType === 'SMART_CONTRACT' ? CONTRACT_FLAGS_MASK : SKILL_FLAGS_MASK
  return FLAG_NAMES.filter(name => (FLAGS[name] & mask) !== 0)
}

const OPTIONS: Verdict[] = ['SAFE', 'CAUTION', 'DANGER']
const NOTE_ID = 'attest-danger-safe-note'

type RadioProps = {
  verdict: Verdict
  checked: boolean
  tabbable: boolean
  disabled: boolean
  suggested: boolean
  onChoose: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
  buttonRef: (element: HTMLButtonElement | null) => void
}

function VerdictRadio(props: RadioProps) {
  const { verdict } = props
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      className="sf-opt"
      disabled={props.disabled}
      tabIndex={props.tabbable ? 0 : -1}
      ref={props.buttonRef}
      onClick={props.onChoose}
      onKeyDown={props.onKeyDown}
    >
      <span aria-hidden="true" className="sf-opt__marker" />
      <span>
        <span className="sf-opt__title">
          {label[verdict]}
          {props.suggested && <span className="sf-mono"> {copy.attest.suggested}</span>}
        </span>
        <span className="sf-opt__help">{help[verdict]}</span>
      </span>
    </button>
  )
}

/** The arrow keys move the choice among the verdicts that may be picked, as a radio group does. */
function useRadioKeys(pickableOptions: Verdict[], onChoose: (verdict: Verdict) => void) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({})
  const move = (from: Verdict, step: number) => {
    const index = pickableOptions.indexOf(from)
    if (index < 0) return
    const next = pickableOptions[(index + step + pickableOptions.length) % pickableOptions.length]
    if (next === undefined) return
    onChoose(next)
    buttons.current[next]?.focus()
  }
  const onKeyDown = (verdict: Verdict, event: React.KeyboardEvent) => {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    if (!forward && !back) return
    event.preventDefault()
    move(verdict, forward ? 1 : -1)
  }
  const buttonRef = (verdict: Verdict) => (element: HTMLButtonElement | null) => {
    buttons.current[verdict] = element
  }
  return { onKeyDown, buttonRef }
}

/** One radio button per verdict. */
function VerdictOptions(props: VerdictStepProps) {
  const { choice, tier } = props
  const pickable = pickableVerdicts(tier)
  const pickableOptions = OPTIONS.filter(verdict => pickable[verdict])
  const keys = useRadioKeys(pickableOptions, props.onChoose)

  return (
    <>
      <section
        role="radiogroup"
        aria-label={copy.attest.yourVerdict}
        aria-describedby={tier === 'CONFIRMED_DANGER' ? NOTE_ID : undefined}
        className="sf-stack"
      >
        {OPTIONS.map(verdict => (
          <VerdictRadio
            key={verdict}
            verdict={verdict}
            checked={choice.verdict === verdict}
            tabbable={choice.verdict === verdict || (choice.verdict === null && verdict === pickableOptions[0])}
            disabled={!pickable[verdict]}
            suggested={props.suggestion === verdict}
            onChoose={() => props.onChoose(verdict)}
            onKeyDown={event => keys.onKeyDown(verdict, event)}
            buttonRef={keys.buttonRef(verdict)}
          />
        ))}
      </section>
      {tier === 'CONFIRMED_DANGER' && (
        <p id={NOTE_ID} className="sf-lead">
          {copy.attest.dangerSafe}
        </p>
      )}
    </>
  )
}

/** The flags of the vote. A Safe vote carries none, so nothing can be added to it. */
function FlagPicker(props: VerdictStepProps) {
  const [adding, setAdding] = useState(false)
  const { choice } = props
  if (choice.verdict === 'SAFE') return null
  const chosen = flagsOf(choice)
  const available = flagsOfType(props.targetType).filter(name => !chosen.includes(name))
  return (
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
      {choice.verdict !== null && choice.flags === 0 && <p className="sf-lead">{copy.attest.needFlag}</p>}
      {choice.verdict !== null && props.scanFlags === 0 && <p className="sf-lead">{copy.attest.noScanFlags}</p>}
    </section>
  )
}

/** A field for every flag whose excerpt does not travel with the report. It stays once it has a quote, so the Guardian can correct it. */
function QuoteFields(props: VerdictStepProps) {
  const { choice } = props
  const waiting = missingQuotes(choice, props.provedFlags)
  const needsQuote = flagsOf(choice).filter(name => (props.provedFlags & FLAGS[name]) === 0)
  return (
    <>
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
            maxLength={quoteLimit(choice.flags)}
            onChange={event => props.onQuote(name, event.target.value)}
          />
        </section>
      ))}
    </>
  )
}

/**
 * The first step: the Guardian picks a verdict and the flags that come with it.
 *
 * The scanner only suggests. Nothing is chosen before the Guardian chooses it, and the suggested
 * verdict is named but never filled in.
 */
export function VerdictStep(props: VerdictStepProps) {
  return (
    <>
      <section className="sf-stack">
        <p className="sf-lead">{copy.attest.twoApprovals}</p>
        {props.suggestion !== null && (
          <p className="sf-lead">{copy.attest.suggestion.replace('{verdict}', verdictLabel(props.suggestion))}</p>
        )}
      </section>
      <VerdictOptions {...props} />
      <FlagPicker {...props} />
      <QuoteFields {...props} />
      <footer className="sf-panel__footer">
        <Button variant="primary" disabled={!props.canContinue} onClick={props.onContinue}>
          {copy.attest.review}
        </Button>
      </footer>
    </>
  )
}
