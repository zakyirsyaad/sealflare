'use client'
import { useState } from 'react'
import { CONSTANTS, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import type { AttestationRow, ScanReport } from '@sealflare/shared/schemas'
import { useUserState } from '../../lib/chain/userState'
import { modulesLive } from '../../lib/chain/config'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { formatUtc, isZeroHash, verdictLabel } from '../../lib/format'
import { AttestPanel } from '../attest/AttestPanel'
import { BountyPanel } from '../bounty/BountyPanel'
import { ChallengeAction } from '../dispute/ChallengeAction'
import { attestAvailability, type AttestAvailability } from '../attest/availability'
import { usePendingVote, type PendingVote } from './pendingVote'

export type ActionColumnProps = {
  tier: TrustTier
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** Scans the skill's repository as it is now. Null when the source is not known. */
  currentVersionHref: string | null
  targetId: string
  /** The word `Core.attest` takes. Null when the target is not known yet. */
  targetWord: string | null
  /** The scanned bundle is another bundle than the one the registry sealed. */
  bundleChanged: boolean
  /** The event log could not be read, so the transaction links of the votes are unknown. */
  evidenceFailed: boolean
  /** The name of the target, as the page shows it. */
  label: string
  scan: ScanReport | null
  attestations: AttestationRow[]
  /** A challenge is open on this target. */
  underDispute: boolean
  /** The id of the open challenge, as the registry names it. Null when none is open. */
  activeChallengeId?: string | null
}

type Vote = { verdict: Verdict; txHash: string }

/** The moment the daily quota returns. The contract counts the days from the unix epoch, so it is the next UTC midnight. */
function nextQuotaReset(): string {
  const day = 86400
  const now = Math.floor(Date.now() / 1000)
  return formatUtc(Math.floor(now / day) * day + day)
}

/** The vote of this user on this target, when there is one. */
function previousVote(address: string | undefined, attestations: AttestationRow[]): Vote | null {
  if (address === undefined) return null
  const row = attestations.find(item => item.guardian.toLowerCase() === address.toLowerCase())
  return row === undefined ? null : { verdict: row.verdict, txHash: row.txHash }
}

/** The vote of this session, when the connected account is the one that cast it. */
function sessionVoteOf(address: string | undefined, vote: PendingVote | null): Vote | null {
  if (vote === null || address === undefined) return null
  if (vote.guardian.toLowerCase() !== address.toLowerCase()) return null
  return { verdict: vote.verdict, txHash: vote.txHash }
}

function limitText(template: string, left: number | null): string {
  return template
    .replace('{left}', String(left))
    .replace('{limit}', String(CONSTANTS.DAILY_ATTEST_LIMIT))
}

/** Why the button is closed, or null when it is open. */
function reasonOf(availability: AttestAvailability): string | null {
  if (availability.kind === 'code-changed') return copy.errors.CodeChangedSincePin
  if (availability.kind !== 'quota-exhausted') return null
  const used = limitText(copy.wallet.quotaExhausted, null)
  return `${used} ${copy.wallet.quotaReturns.replace('{time}', nextQuotaReset())}`
}

/** The vote that is already on the chain. Its link is left out when the transaction is unknown. */
function AttestedButton({ vote, linkKnown }: { vote: Vote; linkKnown: boolean }) {
  const text = copy.attest.alreadyVerdict.replace('{verdict}', verdictLabel(vote.verdict))
  const className = 'sf-btn sf-btn--primary sf-btn--lg sf-btn--block'
  if (!linkKnown || isZeroHash(vote.txHash)) {
    return (
      <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled>
        {text}
      </Button>
    )
  }
  return (
    <a className={className} href={`https://bscscan.com/tx/${vote.txHash}`} target="_blank" rel="noreferrer">
      {text}
    </a>
  )
}

function CurrentVersionButton({ href }: { href: string | null }) {
  if (href === null) {
    return (
      <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled>
        {copy.target.currentVersion}
      </Button>
    )
  }
  return (
    <a className="sf-btn sf-btn--primary sf-btn--lg sf-btn--block" href={href}>
      {copy.target.currentVersion}
    </a>
  )
}

/** What the attest panel needs to know of the target. */
function panelProps(props: ActionColumnProps) {
  return {
    targetId: props.targetId,
    targetWord: props.targetWord,
    targetType: props.targetType,
    label: props.label,
    tier: props.tier,
    scan: props.scan,
    underDispute: props.underDispute,
  }
}

/** The notes under the buttons: the quota, the reason the button is closed and the first-vote invite. */
function Notes(props: { quota: string; reason: string | null; hint: string | null; holder: boolean; tier: TrustTier }) {
  return (
    <div className="sf-actions__meta">
      <p className="sf-mono sf-actions__quota">{props.quota}</p>
      {props.reason !== null && <p className="sf-actions__reason">{props.reason}</p>}
      {props.hint !== null && <p className="sf-actions__note">{props.hint}</p>}
      {props.holder && props.reason === null && <p className="sf-actions__note">{copy.attest.claimable}</p>}
      {props.tier === 'UNRATED' && (
        <div className="sf-actions__invite">
          <p className="sf-actions__invite-title">{copy.attest.first}</p>
          <p className="sf-actions__note">{copy.target.firstXp}</p>
        </div>
      )}
      <p className="sf-actions__note">{copy.target.safeRisk}</p>
    </div>
  )
}

type Primary = {
  availability: AttestAvailability
  reason: string | null
  busy: boolean
  props: ActionColumnProps
  linkKnown: boolean
  onOpen: () => void
}

/** The main button: the attest button, the vote that is already there, or the scan of the current version. */
function PrimaryAction({ availability, reason, busy, props, linkKnown, onOpen }: Primary) {
  if (availability.kind === 'skill-changed') return <CurrentVersionButton href={props.currentVersionHref} />
  if (availability.kind === 'already-attested') return <AttestedButton vote={availability} linkKnown={linkKnown} />
  return (
    <Button variant="primary" className="sf-btn--lg sf-btn--block" disabled={reason !== null || busy} onClick={onOpen}>
      {copy.attest.action}
    </Button>
  )
}

/** The two secondary actions: the challenge, and the bounty that opens with the Vault. */
function SecondaryActions(props: ActionColumnProps & { onFundBounty: () => void }) {
  return (
    <>
      <ChallengeAction
        targetId={props.targetId}
        targetType={props.targetType}
        label={props.label}
        scan={props.scan}
        tier={props.tier}
        activeChallengeId={props.activeChallengeId ?? null}
      />
      <Button
        variant="secondary"
        className="sf-btn--block"
        disabled={!modulesLive}
        onClick={props.onFundBounty}
      >
        {copy.target.fundBounty}
      </Button>
      {/* Every action that waits for the vault says why it is closed. */}
      {!modulesLive && <p className="sf-actions__note">{copy.common.modulesNotLive}</p>}
    </>
  )
}

/**
 * The actions of the target page. The attest button follows the state of the wallet: it is
 * closed with a reason when the user cannot attest yet, and it opens the attest panel when the
 * vote can be written.
 */
export function ActionColumn(props: ActionColumnProps) {
  const user = useUserState()
  const { vote: sessionVote } = usePendingVote()
  const [open, setOpen] = useState(false)
  const [bountyOpen, setBountyOpen] = useState(false)
  const left = user.kind === 'holder' ? user.attestationsLeft : null
  const address = 'address' in user ? user.address : undefined
  const onChain = previousVote(address, props.attestations)
  // The vote of this session counts before the indexer has read it from a final block, but only
  // for the account that cast it. Another account of the same wallet has not voted.
  const previous: Vote | null = onChain ?? sessionVoteOf(address, sessionVote)
  const availability = attestAvailability({
    kind: user.kind,
    attestationsLeft: left,
    tier: props.tier,
    targetType: props.targetType,
    bundleChanged: props.bundleChanged,
    previous,
  })
  const reason = reasonOf(availability)
  return (
    <aside className="sf-actions" aria-label={copy.attest.action}>
      <PrimaryAction
        availability={availability}
        reason={reason}
        busy={user.isLoading || user.isError}
        props={props}
        linkKnown={onChain === null || !props.evidenceFailed}
        onOpen={() => setOpen(true)}
      />
      <SecondaryActions {...props} onFundBounty={() => setBountyOpen(true)} />
      <Notes
        quota={limitText(left === null ? copy.target.quotaDefault : copy.target.quotaLeft, left)}
        reason={reason}
        // Without a wallet the panel itself asks for one, so the button stays open.
        hint={availability.kind === 'no-wallet' ? copy.target.attestHint : null}
        holder={user.kind === 'holder'}
        tier={props.tier}
      />
      {/* Mounted while closed too, so a vote that is on its way is not lost with the dialog. */}
      <AttestPanel {...panelProps(props)} open={open} onClose={() => setOpen(false)} />
      <BountyPanel targetId={props.targetId} label={props.label} open={bountyOpen} onClose={() => setBountyOpen(false)} />
    </aside>
  )
}
