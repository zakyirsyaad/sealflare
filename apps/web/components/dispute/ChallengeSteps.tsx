'use client'
import { FLAGS, type FlagName, type TargetType } from '@sealflare/shared/rules'
import { CONSTANTS } from '@sealflare/shared/rules'
import { STATEMENT_MAX_CHARS, utf8Length } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { flagLabel } from '../../lib/format'
import { flagsOfType } from '../attest/VerdictStep'
import { flagsOf, missingQuotes, type Choice } from '../attest/choice'

export type FlagsStepProps = {
  targetType: TargetType
  choice: Choice
  onToggle: (flag: FlagName) => void
  onContinue: () => void
}

/** The first step: the violations the challenger alleges. The flags of the scan are already ticked. */
export function FlagsStep({ targetType, choice, onToggle, onContinue }: FlagsStepProps) {
  return (
    <>
      <fieldset className="sf-stack sf-fieldset">
        <legend className="sf-mono">{copy.dispute.flagsTitle}</legend>
        <p className="sf-lead">{copy.dispute.flagsHelp}</p>
        {flagsOfType(targetType).map(name => (
          <label key={name} className="sf-checkrow">
            <input type="checkbox" checked={(choice.flags & FLAGS[name]) !== 0} onChange={() => onToggle(name)} />
            <span>{flagLabel(name)}</span>
          </label>
        ))}
      </fieldset>
      {choice.flags === 0 && <p className="sf-lead">{copy.dispute.needFlag}</p>}
      <footer className="sf-panel__footer">
        <Button variant="primary" disabled={choice.flags === 0} onClick={onContinue}>
          {copy.dispute.continue}
        </Button>
      </footer>
    </>
  )
}

export type EvidenceStepProps = {
  choice: Choice
  /** The flags whose excerpt travels with the report. Every other flag needs a quote. */
  provedFlags: number
  statement: string
  /** The summary that will be written on-chain, as it stands now. */
  preview: string
  canContinue: boolean
  onQuote: (flag: FlagName, quote: string) => void
  onStatement: (statement: string) => void
  onBack: () => void
  onContinue: () => void
}

/** A field for every flag whose excerpt does not travel with the report. */
function QuoteFields(props: EvidenceStepProps) {
  const needsQuote = flagsOf(props.choice).filter(name => (props.provedFlags & FLAGS[name]) === 0)
  const waiting = missingQuotes(props.choice, props.provedFlags)
  return (
    <>
      {needsQuote.map(name => (
        <section key={name} className="sf-stack">
          <label className="sf-opt__title" htmlFor={`challenge-quote-${name}`}>
            {copy.attest.quoteFor.replace('{flag}', flagLabel(name))}
          </label>
          {waiting.includes(name) && <p className="sf-lead">{copy.attest.quoteHint}</p>}
          <input
            id={`challenge-quote-${name}`}
            className="sf-input"
            value={props.choice.quotes[name] ?? ''}
            onChange={event => props.onQuote(name, event.target.value)}
          />
        </section>
      ))}
    </>
  )
}

/** The written explanation, which goes to IPFS as part of the report. */
export function StatementField(props: Pick<EvidenceStepProps, 'statement' | 'onStatement'>) {
  const { statement } = props
  return (
    <section className="sf-stack">
      <label className="sf-opt__title" htmlFor="challenge-statement">
        {copy.dispute.statementLabel}
      </label>
      <p className="sf-lead">{copy.dispute.statementHint}</p>
      <textarea
        id="challenge-statement"
        className="sf-input sf-textarea"
        rows={6}
        maxLength={STATEMENT_MAX_CHARS}
        value={statement}
        onChange={event => props.onStatement(event.target.value)}
      />
      <p className="sf-lead">
        {copy.dispute.statementCount.replace('{used}', String(statement.length)).replace('{max}', String(STATEMENT_MAX_CHARS))}
      </p>
      {statement.trim() === '' && <p className="sf-lead">{copy.dispute.statementRequired}</p>}
    </section>
  )
}

/** The part of the evidence that is written on-chain, with the room it has left. */
function ProofPreview({ preview }: { preview: string }) {
  const used = utf8Length(preview)
  return (
    <section className="sf-stack">
      <span className="sf-mono">{copy.dispute.proofTitle}</span>
      {preview === '' ? <p className="sf-lead">{copy.dispute.proofEmpty}</p> : <pre className="sf-mono sf-proof">{preview}</pre>}
      <p className="sf-lead">
        {copy.dispute.proofBytes.replace('{used}', String(used)).replace('{max}', String(CONSTANTS.SHORT_PROOF_MAX_BYTES))}
      </p>
    </section>
  )
}

/**
 * The second step: a short quote for every flag the scanner did not prove, and the written
 * explanation. The quotes go on-chain, the explanation goes to IPFS.
 */
export function EvidenceStep(props: EvidenceStepProps) {
  return (
    <>
      <QuoteFields {...props} />
      <StatementField statement={props.statement} onStatement={props.onStatement} />
      <ProofPreview preview={props.preview} />
      <footer className="sf-panel__footer">
        <Button variant="primary" disabled={!props.canContinue} onClick={props.onContinue}>
          {copy.dispute.continue}
        </Button>
        <Button variant="secondary" onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
