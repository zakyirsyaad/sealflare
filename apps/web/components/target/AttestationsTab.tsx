import type { AttestationRow } from '@sealflare/shared/schemas'
import { flagNames } from '@sealflare/shared/rules'
import { Chip } from '../ui/Chip'
import { copy } from '../../lib/copy'
import { flagLabel, shortAddress } from '../../lib/format'

export type AttestationsTabProps = { rows: readonly AttestationRow[] }

const ZERO_HASH = `0x${'0'.repeat(64)}`

function Flags({ flags }: { flags: number }) {
  const names = flagNames(flags)
  if (names.length === 0) return <span className="sf-status__fact-note">{copy.target.none}</span>
  return (
    <span className="sf-signal__flags">
      {names.map(name => (
        <Chip key={name} className="sf-chip--flag sf-chip--danger">
          {flagLabel(name)}
        </Chip>
      ))}
    </span>
  )
}

/** Who voted, what they voted, with which flags and how much weight it carried. */
export function AttestationsTab({ rows }: AttestationsTabProps) {
  if (rows.length === 0) return <p className="sf-tab__empty">{copy.target.noAttestations}</p>
  return (
    <table className="sf-table">
      <caption className="sf-sr-only">{copy.target.attestations}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.target.guardian}</th>
          <th scope="col">{copy.target.verdict}</th>
          <th scope="col">{copy.target.flags}</th>
          <th scope="col">{copy.target.weight}</th>
          <th scope="col">{copy.target.evidence}</th>
          <th scope="col">{copy.target.transaction}</th>
          <th scope="col">{copy.target.when}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.index}>
            <td className="sf-mono" data-label={copy.target.guardian}>
              {shortAddress(row.guardian)}
            </td>
            <td data-label={copy.target.verdict}>{row.verdict}</td>
            <td data-label={copy.target.flags}>
              <Flags flags={row.flags} />
            </td>
            <td className="sf-mono" data-label={copy.target.weight}>
              {row.weight}
            </td>
            <td data-label={copy.target.evidence}>
              {row.evidenceURI === '' ? (
                <span className="sf-status__fact-note">{copy.target.none}</span>
              ) : (
                <a href={row.evidenceURI} target="_blank" rel="noreferrer">
                  {copy.target.evidence}
                </a>
              )}
            </td>
            <td className="sf-mono" data-label={copy.target.transaction}>
              {row.txHash === ZERO_HASH ? (
                <span className="sf-status__fact-note">{copy.target.none}</span>
              ) : (
                <a href={`https://bscscan.com/tx/${row.txHash}`} target="_blank" rel="noreferrer">
                  {row.txHash.slice(0, 10)}
                </a>
              )}
            </td>
            <td className="sf-mono" data-label={copy.target.when}>
              {row.at.slice(0, 10)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
