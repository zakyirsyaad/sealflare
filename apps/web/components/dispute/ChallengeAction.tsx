'use client'
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { courtAbi } from '@sealflare/shared/abi'
import type { TargetType, TrustTier } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { expectedChainId, modulesLive } from '../../lib/chain/config'
import { courtAddress } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { formatUtc } from '../../lib/format'
import { ChallengePanel } from './ChallengePanel'

export type ChallengeActionProps = {
  targetId: string
  targetType: TargetType
  /** The name of the target, as the page shows it. */
  label: string
  scan: ScanReport | null
  tier: TrustTier
  /** The id of the open challenge on this target, as a decimal string. Null when none is open. */
  activeChallengeId: string | null
}

/** The end of the cooldown of this wallet on this target, in unix seconds, when it is still running. */
function useCooldownEnd(targetId: string): bigint | null {
  const user = useUserState()
  const court = courtAddress()
  const account = user.kind === 'holder' ? user.address : undefined
  const read = useReadContract({
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    functionName: 'cooldownEndsAt',
    args: account === undefined ? undefined : [account, targetId as `0x${string}`],
    query: { enabled: court !== null && account !== undefined },
  } as Parameters<typeof useReadContract>[0])
  const ends = typeof read.data === 'bigint' ? read.data : 0n
  return Number(ends) * 1000 > Date.now() ? ends : null
}

/** The id of the challenge the Court holds open on this target, or null. Undefined until the Court answers. */
function useOpenChallenge(targetId: string) {
  const court = courtAddress()
  const read = useReadContract({
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    functionName: 'activeChallengeOf',
    args: [targetId as `0x${string}`],
    query: { enabled: court !== null, refetchInterval: 15_000 },
  })
  const open = typeof read.data === 'bigint' ? (read.data > 0n ? read.data.toString() : null) : undefined
  return { open, refetch: read.refetch }
}

/**
 * The link to the open challenge, or the button that opens the panel, or the reason it cannot.
 *
 * The open challenge is read from the Court, so a challenge opened a moment ago turns the button
 * into a link without a reload. Until the Court answers, the page's own reading stands.
 */
function LiveChallenge(props: ChallengeActionProps) {
  const [open, setOpen] = useState(false)
  const cooldownEnd = useCooldownEnd(props.targetId)
  const active = useOpenChallenge(props.targetId)
  const openId = active.open === undefined ? props.activeChallengeId : active.open
  // The panel is kept while it is open: a challenge it just sent must not take the panel away
  // while the transaction is still being confirmed.
  const panel = open && (
    <ChallengePanel
      targetId={props.targetId}
      targetType={props.targetType}
      label={props.label}
      scan={props.scan}
      onClose={() => {
        setOpen(false)
        void active.refetch()
      }}
    />
  )
  if (openId !== null) {
    return (
      <>
        <a className="sf-btn sf-btn--secondary sf-btn--block" href={`/app/disputes/${openId}`}>
          {copy.dispute.viewOpen}
        </a>
        {panel}
      </>
    )
  }
  return (
    <>
      <Button variant="secondary" className="sf-btn--block" disabled={cooldownEnd !== null} onClick={() => setOpen(true)}>
        {copy.dispute.action}
      </Button>
      {cooldownEnd !== null && (
        <p className="sf-actions__note">{copy.dispute.cooldownUntil.replace('{time}', formatUtc(cooldownEnd))}</p>
      )}
      {panel}
    </>
  )
}

/**
 * The challenge action of the target page, in the order of ux.md 8.1: a target that is already
 * confirmed dangerous has no button, a deployment whose modules are not live has a disabled one
 * with the fixed sentence, an open challenge turns the button into a link, and a cooldown closes it
 * with the date it ends.
 */
export function ChallengeAction(props: ChallengeActionProps) {
  if (props.tier === 'CONFIRMED_DANGER') return null
  if (!modulesLive) {
    return (
      <>
        <Button variant="secondary" className="sf-btn--block" disabled>
          {copy.dispute.action}
        </Button>
        <p className="sf-actions__note">{copy.common.modulesNotLive}</p>
      </>
    )
  }
  return <LiveChallenge {...props} />
}
