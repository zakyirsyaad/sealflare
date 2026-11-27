'use client'
import { useEffect, useState } from 'react'
import { BountySummary } from '@sealflare/shared/schemas'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton } from '../ui/Skeleton'
import { modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { copy } from '../../lib/copy'
import { formatBnb, formatDate, formatUtc } from '../../lib/format'
import { settleAtOf } from '../../lib/bounty/settle'
import { useChainTime, CHAIN_REFRESH } from '../../lib/bounty/chainTime'
import { SettleButton } from './SettleButton'

export type BountyTabProps = {
  /** The id of the target the bounty is about. */
  targetId: string
}

type Load = { status: 'loading' | 'ready' | 'failed'; bounty: BountySummary | null }

/**
 * The bounty of a target that is still open comes first, so a reader sees the one that can still
 * be filled. A target can have more than one bounty, and the newest one is the one that counts.
 */
function pickBounty(items: readonly BountySummary[]): BountySummary | null {
  const newest = [...items].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  return newest.find(item => !item.settled) ?? newest[0] ?? null
}

/** The answer of the public API, with the rows it holds. */
function rowsOf(body: unknown): BountySummary[] | null {
  if (body === null || typeof body !== 'object') return null
  const data = (body as { data?: unknown }).data
  if (data === null || typeof data !== 'object') return null
  const items = (data as { items?: unknown }).items
  const parsed = BountySummary.array().safeParse(items)
  return parsed.success ? parsed.data : null
}

/** The facts of a bounty, and when it can be settled. */
function BountyFacts({ bounty, now, failed }: { bounty: BountySummary; now: number | null; failed: boolean }) {
  const at = settleAtOf(bounty)
  const ready = now !== null && at !== null && now * 1000 >= at.getTime()
  const settle = bounty.settled
    ? copy.bounty.settled
    : at === null
      ? copy.bounty.settleTimeUnknown
      : ready
        ? copy.bounty.settleNow
        : copy.bounty.settleAt.replace('{time}', formatUtc(at.getTime() / 1000))
  return (
    <div className="sf-tab__facts">
      <p>{copy.bounty.amount.replace('{amount}', formatBnb(bounty.amount))}</p>
      <p>{copy.bounty.filled.replace('{filled}', String(bounty.filled)).replace('{slots}', String(bounty.slots))}</p>
      <p>
        {copy.bounty.created}: {formatDate(bounty.createdAt)}
      </p>
      {settle !== null && <p>{settle}</p>}
      {/* The moment is known, but the chain could not be read, so it is not known whether the
          window has already passed. */}
      {failed && !bounty.settled && <p className="sf-lead">{copy.bounty.chainTimeFailed}</p>}
    </div>
  )
}

/**
 * The Bounty tab of a target.
 *
 * It shows the bounty of the target, the slots it filled and the moment it can be settled. The
 * window is judged by the time of the chain, so a browser with a wrong clock is never told that
 * a bounty may be settled.
 */
export function BountyTab({ targetId }: BountyTabProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading', bounty: null })
  const [tries, setTries] = useState(0)
  const time = useChainTime()
  const gate = moduleGate(modulesLive)

  useEffect(() => {
    let live = true
    const read = (): void => {
      // A bounty that is already on the page stays there while it is read again, so the tab does
      // not blink every minute.
      setLoad(previous => (previous.status === 'ready' ? previous : { status: 'loading', bounty: null }))
      fetch(`/api/bounties?targetId=${encodeURIComponent(targetId)}`)
        .then(response => {
          if (!response.ok) throw new Error('the bounties could not be read')
          return response.json() as Promise<unknown>
        })
        .then(body => {
          const rows = rowsOf(body)
          if (rows === null) throw new Error('the bounties could not be read')
          if (!live) return
          setLoad({ status: 'ready', bounty: pickBounty(rows) })
        })
        .catch(() => {
          // A bounty that is already on the page stays there, so a settlement that is on its way
          // is not lost when a later read of the index fails.
          if (live) {
            setLoad(previous => (previous.status === 'ready' ? previous : { status: 'failed', bounty: null }))
          }
        })
    }
    read()
    // The rows are read again on the same rhythm as the clock of the chain, so a bounty that is
    // filled while the tab is open is not stale.
    const timer = setInterval(read, CHAIN_REFRESH)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [targetId, tries])

  if (load.status === 'loading') return <Skeleton />
  if (load.status === 'failed') {
    return <ErrorState what={copy.bounty.loadFailed} onChainSafe onRetry={() => setTries(count => count + 1)} />
  }
  if (load.bounty === null) return <p className="sf-tab__empty">{copy.target.noBounty}</p>
  return (
    <div className="sf-stack">
      <BountyFacts bounty={load.bounty} now={time.now} failed={time.failed} />
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      {!gate.disabled && <SettleButton bounty={load.bounty} now={time.now} />}
    </div>
  )
}
