import { flagNames } from '@sealflare/shared/rules'
import { parseShortProof } from '@sealflare/shared/schemas'
import { Chip } from '../ui/Chip'
import { copy } from '../../lib/copy'
import { evidenceHref } from '../../lib/evidenceLink'
import { flagLabel, shortAddress } from '../../lib/format'

export type EvidenceBoxProps = {
  challenger: string
  flags: number
  shortProof: string
  evidenceURI: string
}

/** What the challenger claims: the flags, the quote written on-chain and the link to the full report. */
export function EvidenceBox({ challenger, flags, shortProof, evidenceURI }: EvidenceBoxProps) {
  const href = evidenceHref(evidenceURI)
  const quotes = parseShortProof(shortProof)
  return (
    <section className="sf-frame sf-evidence" aria-label={copy.dispute.challenger}>
      <div className="sf-rows__row sf-evidence__head">
        <span className="sf-mono">{copy.dispute.challenger}</span>
        <span className="sf-mono">{shortAddress(challenger)}</span>
      </div>
      <div className="sf-stack sf-evidence__body">
        <p className="sf-opt__title">{copy.dispute.claims}</p>
        <div className="sf-flags">
          {flagNames(flags).map(name => (
            <Chip key={name} className="sf-chip--flag sf-chip--danger">
              {flagLabel(name)}
            </Chip>
          ))}
        </div>
        {quotes.length > 0 ? (
          quotes.map(item => (
            <pre key={item.flag} className="sf-mono sf-proof">
              {item.excerpt}
            </pre>
          ))
        ) : (
          shortProof !== '' && <pre className="sf-mono sf-proof">{shortProof}</pre>
        )}
        {href === null ? (
          <p className="sf-lead">{copy.dispute.evidenceUnavailable}</p>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">
            {copy.dispute.fullEvidence}
          </a>
        )}
      </div>
    </section>
  )
}
