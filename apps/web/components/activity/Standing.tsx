'use client'
import { CONSTANTS, weightOf } from '@sealflare/shared/rules'
import { copy } from '../../lib/copy'
import { ErrorState } from '../ui/ErrorState'

export type StandingProps = {
  /** The score of the account, as the registry holds it. */
  score: number | null
  /** The vote weight of the account. */
  weight: number | null
  /** How many points are left to the next weight. */
  toNextWeight: number | null
  /** How many attestations the account may still cast today. */
  attestationsLeft: number | null
  /** The chain could not be read, so there is no standing to show. */
  failed: boolean
  /** Called when the reader asks for the standing again. */
  onRetry: () => void
}

/** The highest weight the frozen rules give. */
const MAX_WEIGHT = weightOf(Number.MAX_SAFE_INTEGER)

/**
 * The standing of the account: its score, its vote weight and what it may still attest today.
 *
 * Every number comes from the registry contract, so a reader never sees a standing that the chain
 * has already changed. A read that fails is shown as a failure, and a weight that is not read yet
 * is not shown as a weight of zero.
 */
export function Standing({ score, weight, toNextWeight, attestationsLeft, failed, onRetry }: StandingProps) {
  const headline = weightText(weight)
  return (
    <section className="sf-frame" aria-label={copy.activity.standing}>
      <div className="sf-panel__head"><h2>{copy.activity.standing}</h2></div>
      {failed ? (
        <ErrorState what={copy.activity.standingFailed} onChainSafe onRetry={onRetry} />
      ) : (
        <div className="sf-standing">
          <div className="sf-standing__weight">
            <p className="sf-standing__headline">{headline}</p>
            <div className="sf-weight" role="img" aria-label={headline}>
              {Array.from({ length: MAX_WEIGHT }, (_, step) => (
                <span key={step} className={step < (weight ?? 0) ? 'sf-weight__step sf-weight__step--on' : 'sf-weight__step'} />
              ))}
            </div>
            <p className="sf-lead">{nextWeightText(weight, toNextWeight)}</p>
          </div>
          <div className="sf-rows">
            <div className="sf-rows__row">
              <span className="sf-rows__name">{copy.activity.reputation}</span>
              <span className="sf-rows__value sf-mono">{score === null ? copy.common.loading : String(score)}</span>
            </div>
            <div className="sf-rows__row">
              <span className="sf-rows__name">{copy.activity.attestationsLeft}</span>
              <span className="sf-rows__value sf-mono">
                {attestationsLeft === null
                  ? copy.common.loading
                  : `${attestationsLeft} of ${CONSTANTS.DAILY_ATTEST_LIMIT}`}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** The weight of the account, in the words of the screen. */
function weightText(weight: number | null): string {
  if (weight === null) return copy.common.loading
  return copy.activity.weight.replace('{weight}', String(weight)).replace('{max}', String(MAX_WEIGHT))
}

/** What is left to the next weight, in the words of the screen. */
function nextWeightText(weight: number | null, toNextWeight: number | null): string {
  if (weight === null) return copy.common.loading
  if (toNextWeight === null) return copy.activity.topWeight
  return copy.activity.nextWeight.replace('{count}', String(toNextWeight)).replace('{weight}', String(weight + 1))
}
