import type { TargetType } from '@sealflare/shared/rules'
import { TargetTypeSchema } from '@sealflare/shared/schemas'
import { VerdictSchema, type Verdict } from './verdict'

/**
 * The state of a list page, read from the query of the request.
 *
 * The query is the state of the page, so it survives a reload and a shared link. A query that
 * holds something the page does not know is ignored: the page shows the whole list instead of
 * failing over a word in the address bar.
 */

/** The kind of target a list shows, or null when the list shows every kind. */
export function readKind(value: string | undefined): TargetType | null {
  if (value === undefined) return null
  const parsed = TargetTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The verdict a list is filtered by, or null when it is not filtered. */
export function readVerdict(value: string | undefined): Verdict | null {
  if (value === undefined) return null
  const parsed = VerdictSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The page a list shows. The first page is the default. */
export function readPage(value: string | undefined): number {
  if (value === undefined) return 1
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return 1
  return parsed
}
