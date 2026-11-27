import { ActivityResponse, type ActivityItem, type NeedsAction } from '@sealflare/shared/schemas'

/**
 * The activity of one account, read from the public API.
 *
 * The answer is checked with the frozen schema of the read model, so a row that does not fit is
 * never shown. An answer that cannot be read is a failure, never an empty activity.
 */
export type ActivityReading = {
  needsAction: NeedsAction[]
  history: ActivityItem[]
}

export async function loadActivity(address: string): Promise<ActivityReading> {
  const response = await fetch(`/api/activity/${address}`)
  const payload = await response.json().catch(() => null)
  const parsed = ActivityResponse.safeParse(payload)
  if (!parsed.success || !parsed.data.success) throw new Error('The activity could not be read.')
  return { needsAction: parsed.data.data.needsAction, history: parsed.data.data.history }
}
