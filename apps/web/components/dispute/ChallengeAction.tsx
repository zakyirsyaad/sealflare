'use client'
import { useState } from 'react'
import { useBlock, useReadContract } from 'wagmi'
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

/** How often the chain is read again, so the button follows the chain instead of the page load. */
const REFRESH_MS = 15_000

/**
 * The clock of the chain.
 *
 * The cooldown is judged by the time of the last block, not by the clock of the browser, so a
 * browser whose clock runs ahead cannot enable a button that the Court would refuse.
 */
function useChainClock(): bigint | null {
  const block = useBlock({ chainId: expectedChainId, query: { refetchInterval: REFRESH_MS } })
  return typeof block.data?.timestamp === 'bigint' ? block.data.timestamp : null
}

/** The cooldown of this wallet on this target: when it ends, and whether it is known at all. */
type Cooldown = { ends: bigint | null; unknown: boolean }

function useCooldown(targetId: string): Cooldown {
  const user = useUserState()
  const court = courtAddress()
  const account = user.kind === 'holder' ? user.address : undefined
  const read = useReadContract({
    abi: courtAbi,
    address: court ?? undefined,
    chainId: expectedChainId,
    functionName: 'cooldownEndsAt',
    args: account === undefined ? undefined : [account, targetId as `0x${string}`],
    query: { enabled: court !== null && account !== undefined, refetchInterval: REFRESH_MS },
  } as Parameters<typeof useReadContract>[0])
  const clock = useChainClock()
  // Without a wallet there is no cooldown to read, and nothing is read at all.
  if (account === undefined) return { ends: null, unknown: false }
  // A read that failed or has not answered leaves the cooldown unknown, and the button closed.
  if (typeof read.data !== 'bigint' || clock === null) return { ends: null, unknown: true }
  return { ends: read.data > clock ? read.data : null, unknown: false }
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
  const cooldown = useCooldown(props.targetId)
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
  // The panel is always the last child, in the same place in both branches. A panel that moves
  // is unmounted and mounted again by React, and the receipt of a transaction that was sent is
  // dropped with it, so the link to that transaction is never shown.
  return (
    <>
      {openId !== null ? (
        <a className="sf-btn sf-btn--secondary sf-btn--block" href={`/app/disputes/${openId}`}>
          {copy.dispute.viewOpen}
        </a>
      ) : (
        <>
          <Button
            variant="secondary"
            className="sf-btn--block"
            disabled={cooldown.ends !== null || cooldown.unknown}
            onClick={() => setOpen(true)}
          >
            {copy.dispute.action}
          </Button>
          {cooldown.ends !== null && (
            <p className="sf-actions__note">{copy.dispute.cooldownUntil.replace('{time}', formatUtc(cooldown.ends))}</p>
          )}
        </>
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
