import type { Address, Hex } from 'viem'
import { PublisherBondPanel } from './PublisherBondPanel'
import { copy } from '../../lib/copy'
import { formatBnb, formatUtc } from '../../lib/format'
import type { BindMethod, PublisherRole } from '../../lib/publish/binding'
import type { PublisherBond } from '../../lib/publish/bond'

export type PublisherTabProps = {
  targetId: Hex
  role: PublisherRole
  publisher: Address | null
  /** How the target was bound, read from the event log of Core. */
  method: BindMethod | null
  /** The bond of the publisher, as the vault holds it. */
  bond: PublisherBond | null
}

/** The words for the way the target was bound. */
function proofText(method: BindMethod | null): string {
  switch (method) {
    case 'OWNER':
      return copy.publisher.proofOwner
    case 'DEPLOYER':
      return copy.publisher.proofDeployer
    case 'SKILL':
      return copy.publisher.proofSkill
    case 'SPONSOR':
      return copy.publisher.proofSponsor
    default:
      return copy.publisher.proofUnknown
  }
}

/** The state of the withdrawal of the bond of the publisher. */
function withdrawalText(bond: PublisherBond): string | null {
  if (bond.lockedByChallengeId !== null) return copy.publisher.bondLocked
  if (bond.withdrawalAvailableAt === null) return null
  const now = Math.floor(Date.now() / 1000)
  return bond.withdrawalAvailableAt <= now
    ? copy.publisher.bondReady
    : copy.publisher.bondPending.replace('{time}', formatUtc(bond.withdrawalAvailableAt))
}

/**
 * The Publisher tab. It shows who is behind the target, how that was proven, and the bond of the
 * publisher with the state of its withdrawal. The bond actions come from the wallet of the
 * visitor: the server signs nothing.
 */
export function PublisherTab({ targetId, role, publisher, method, bond }: PublisherTabProps) {
  if (role === 'NONE') return <p className="sf-tab__empty">{copy.target.noPublisher}</p>
  const withdrawal = bond === null ? null : withdrawalText(bond)
  return (
    <div className="sf-stack">
      <div className="sf-tab__facts">
        <p>
          {copy.publisher.role}: {role === 'VERIFIED_PUBLISHER' ? copy.publish.verifiedPublisher : copy.publish.sponsor}
        </p>
        <p>
          {copy.publisher.proof}: {proofText(method)}
        </p>
        <p>
          {copy.publisher.publisherBond}:{' '}
          {bond === null ? copy.publisher.bondNone : copy.publisher.bondAmount.replace('{amount}', formatBnb(bond.amount))}
        </p>
        {withdrawal !== null && <p>{withdrawal}</p>}
      </div>
      <PublisherBondPanel targetId={targetId} publisher={publisher} />
    </div>
  )
}
