import type { NeedsAction } from '@sealflare/shared/schemas'
import { CONSTANTS } from '@sealflare/shared/rules'
import { copy } from '../copy'
import { formatBnb, shortAddress } from '../format'

/**
 * What the Needs action panel shows, one row per thing that waits on the account.
 *
 * The rows come from the indexed rows of the account, so an action never says something the
 * chain has not said yet. The order of the rows is the order of urgency: the action that is due
 * first comes first.
 */

/** What a row asks the reader to do. */
export type ActionKind = 'reveal' | 'reply' | 'close' | 'claim' | 'bond' | 'bounty'

/** One row of the Needs action panel. */
export type ActionRow = {
  key: string
  kind: ActionKind
  title: string
  detail: string
  targetId: string
  /** The dispute the row belongs to, when it belongs to one. */
  challengeId: string | null
  /** The moment the row is due, when it has one. */
  dueAt: string | null
}

/**
 * The kinds of action, in the order the panel shows them when two are due at the same time.
 *
 * The order is the order of the screen: a vote that is about to be lost comes before a bond that
 * may be withdrawn.
 */
export const URGENCY: NeedsAction['kind'][] = [
  'REVEAL_DUE',
  'REPLY_DUE',
  'CAN_CLOSE',
  'XP_CLAIMABLE',
  'BOND_READY',
  'BOUNTY_SETTLEABLE',
]

/**
 * The actions of an account, the ones that are due first at the top.
 *
 * An action without a deadline waits for the ones that have one, and two actions that are due
 * at the same moment keep the order of their kinds.
 */
export function sortByUrgency(items: readonly NeedsAction[]): NeedsAction[] {
  return [...items].sort((left, right) => {
    const leftTime = dueTime(left)
    const rightTime = dueTime(right)
    if (leftTime !== rightTime) return leftTime - rightTime
    return URGENCY.indexOf(left.kind) - URGENCY.indexOf(right.kind)
  })
}

/**
 * The actions of the panel, one row each.
 *
 * Two actions of the same kind on the same target are one row: the panel counts the rows it
 * shows, and the mark on the wallet button counts the same rows.
 */
export function uniqueRows(items: readonly NeedsAction[]): NeedsAction[] {
  const seen = new Set<string>()
  const rows: NeedsAction[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(item)
  }
  return rows
}

/**
 * The actions that can still be done.
 *
 * A reveal whose window closed cannot be revealed any more, so it is gone from the panel and
 * from the count of the mark on the wallet button. The moment is the time of the chain and not
 * the clock of the browser, so a browser that is a few minutes off does not move the boundary.
 */
export function visibleRows(items: readonly NeedsAction[], now: Date | null): NeedsAction[] {
  if (now === null) return [...items]
  return items.filter(item => !isClosed(item, now))
}

/** Whether the action of the row can no longer be done. */
function isClosed(item: NeedsAction, now: Date): boolean {
  if (item.kind !== 'REVEAL_DUE' || item.dueAt === undefined) return false
  const time = Date.parse(item.dueAt)
  if (Number.isNaN(time)) return false
  return time <= now.getTime()
}

/** The moment an action is due. An action without a deadline waits for the others. */
function dueTime(item: NeedsAction): number {
  if (item.dueAt === undefined) return Number.POSITIVE_INFINITY
  const time = Date.parse(item.dueAt)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/** The key of an action. The key names the action, so it does not change from render to render. */
function keyOf(item: NeedsAction): string {
  return `${item.kind}:${item.targetId}:${item.challengeId ?? item.bountyId ?? ''}`
}

/** The row of one action. */
export function rowOf(item: NeedsAction): ActionRow {
  const target = shortAddress(item.targetId)
  return {
    key: keyOf(item),
    kind: kindOf(item.kind),
    title: titleOf(item, target),
    detail: detailOf(item, target),
    targetId: item.targetId,
    challengeId: item.challengeId ?? null,
    dueAt: item.dueAt ?? null,
  }
}

/** What a kind of action asks the reader to do. */
function kindOf(kind: NeedsAction['kind']): ActionKind {
  if (kind === 'REVEAL_DUE') return 'reveal'
  if (kind === 'REPLY_DUE') return 'reply'
  if (kind === 'CAN_CLOSE') return 'close'
  if (kind === 'XP_CLAIMABLE') return 'claim'
  if (kind === 'BOND_READY') return 'bond'
  return 'bounty'
}

/** The heading of a row. */
function titleOf(item: NeedsAction, target: string): string {
  switch (item.kind) {
    case 'REVEAL_DUE':
      return copy.activity.revealTitle.replace('{id}', item.challengeId ?? '')
    case 'REPLY_DUE':
      return copy.activity.replyTitle.replace('{target}', target)
    case 'CAN_CLOSE':
      return copy.activity.closeTitle.replace('{target}', target)
    case 'XP_CLAIMABLE':
      return copy.activity.claimTitle
    case 'BOND_READY':
      return copy.activity.bondTitle.replace('{target}', target)
    case 'BOUNTY_SETTLEABLE':
      return copy.activity.bountyTitle.replace('{target}', target)
  }
}

/** The sentence under the heading of a row. */
function detailOf(item: NeedsAction, target: string): string {
  switch (item.kind) {
    case 'REVEAL_DUE':
      return copy.activity.revealDetail
        .replace('{stake}', formatBnb(CONSTANTS.JURY_STAKE))
        .replace('{unit}', copy.common.bnb)
    case 'REPLY_DUE':
      return copy.activity.replyDetail.replace('{target}', target)
    case 'CAN_CLOSE':
      return copy.activity.closeDetail.replace('{target}', target)
    case 'XP_CLAIMABLE':
      return item.detail
    case 'BOND_READY':
      return copy.activity.bondDetail.replace('{target}', target)
    case 'BOUNTY_SETTLEABLE':
      return copy.activity.bountyDetail.replace('{target}', target)
  }
}

/**
 * The time left until a row is due, in the words of the screen.
 *
 * The moment of the chain is the one the countdown is measured against, and the countdown is not
 * shown at all while the chain has not said what time it is.
 */
export function dueText(dueAt: string | null, now: Date | null): string | null {
  if (dueAt === null || now === null) return null
  const time = Date.parse(dueAt)
  if (Number.isNaN(time)) return null
  if (time <= now.getTime()) return copy.activity.dueNow
  const minutes = Math.max(0, Math.ceil((time - now.getTime()) / 60000))
  const left = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  return copy.activity.dueIn.replace('{time}', left)
}
