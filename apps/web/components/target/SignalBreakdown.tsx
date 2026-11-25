import type { SignalGroup } from '@sealflare/shared/schemas'
import { flagNames } from '@sealflare/shared/rules'
import { Chip } from '../ui/Chip'
import { copy } from '../../lib/copy'
import { flagLabel } from '../../lib/format'

export type SignalBreakdownProps = { signal: { newIds: SignalGroup; guardians: SignalGroup } }

function FlagChips({ flags }: { flags: number }) {
  const names = flagNames(flags)
  if (names.length === 0) return <span className="sf-status__fact-note">{copy.target.none}</span>
  return (
    <span className="sf-signal__flags">
      {names.map(name => (
        <Chip key={name} className="sf-chip--flag sf-chip--danger" data-flag={name}>
          {flagLabel(name)}
        </Chip>
      ))}
    </span>
  )
}

function Row({ label, note, group }: { label: string; note: string; group: SignalGroup }) {
  const weight = group.weight.safe + group.weight.caution + group.weight.danger
  return (
    <tr>
      <th scope="row" className="sf-signal__who">
        {label}
        <span className="sf-signal__note">{note}</span>
      </th>
      <td className="sf-mono" data-label={copy.attest.safe}>
        {group.votes.safe}
      </td>
      <td className="sf-mono" data-label={copy.attest.caution}>
        {group.votes.caution}
      </td>
      <td className="sf-mono" data-label={copy.attest.danger}>
        {group.votes.danger}
      </td>
      <td data-label={copy.target.flagsReported}>
        <FlagChips flags={group.flags} />
      </td>
      <td className="sf-mono sf-signal__weight" data-label={copy.target.weight}>
        {weight}
      </td>
    </tr>
  )
}

/**
 * The two groups are counted apart: new Agent IDs carry weight 1, experienced Guardians carry
 * weight 2 or more. The signal is never collapsed into a single number.
 */
export function SignalBreakdown({ signal }: SignalBreakdownProps) {
  return (
    <table className="sf-table sf-signal">
      <caption className="sf-sr-only">{copy.target.communitySignal}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.target.who}</th>
          <th scope="col">{copy.attest.safe}</th>
          <th scope="col">{copy.attest.caution}</th>
          <th scope="col">{copy.attest.danger}</th>
          <th scope="col">{copy.target.flagsReported}</th>
          <th scope="col">{copy.target.weight}</th>
        </tr>
      </thead>
      <tbody>
        <Row label={copy.target.newIds} note={copy.target.weightOne} group={signal.newIds} />
        <Row
          label={copy.target.guardians}
          note={copy.target.combinedWeight.replace('{weight}', String(signal.guardians.weight.safe + signal.guardians.weight.caution + signal.guardians.weight.danger))}
          group={signal.guardians}
        />
      </tbody>
    </table>
  )
}
