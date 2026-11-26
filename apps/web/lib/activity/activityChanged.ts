'use client'

/**
 * The event that says the rows of the account have changed.
 *
 * The mark on the wallet button is read on every screen of the application, so a settlement that
 * happens on one screen tells the other screens that the count is not the same any more.
 */
export const ACTIVITY_CHANGED = 'sealflare:activity-changed'

/** Says that the rows of the account have changed. */
export function notifyActivityChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(ACTIVITY_CHANGED))
}
