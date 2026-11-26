import { decodeSrc } from '@sealflare/shared/schemas'
import type { Db } from '../db'

/**
 * The source of a target, and the rule that keeps it pinned.
 *
 * A contract's source is its address, and the indexer stored it. A skill's source is the pinned
 * GitHub reference of its cached scan, because the contract only knows the bundle hash. The
 * column of a skill is only used when it holds a reference that decodes, so a row that was
 * written with something else in it is answered with no source instead of breaking the list.
 */

/**
 * The source of a target.
 *
 * The column of a skill wins when it holds a reference that decodes, so the source the indexer
 * pinned is never replaced by a later scan. The cached scan is the fallback.
 */
export function sourceOf(
  targetType: string,
  columnSrc: string | null,
  scannedSrc: string | undefined,
): string | null {
  if (targetType !== 'AI_SKILL_BUNDLE') return columnSrc
  if (columnSrc && decodeSrc(columnSrc)?.kind === 'skill') return columnSrc
  if (scannedSrc && decodeSrc(scannedSrc)?.kind === 'skill') return scannedSrc
  return null
}

/**
 * Whether two sources name the same repository.
 *
 * The target id of a skill binds the content and the publisher, not the repository, so a byte for
 * byte copy of the folder in another repository is the same target. The repository of a skill is
 * pinned with the first scan, so a copy never becomes the source of the target. A new commit of
 * the same repository is still the same repository, so it still refreshes the scan.
 */
export function sameRepository(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false
  const first = decodeSrc(left)
  const second = decodeSrc(right)
  if (first === null || second === null) return left === right
  if (first.kind === 'contract' && second.kind === 'contract') {
    return first.address.toLowerCase() === second.address.toLowerCase()
  }
  if (first.kind === 'skill' && second.kind === 'skill') {
    // GitHub treats owner and repository names case-insensitively.
    return (
      first.owner.toLowerCase() === second.owner.toLowerCase() && first.repo.toLowerCase() === second.repo.toLowerCase()
    )
  }
  return false
}

/**
 * The pinned reference of every skill of a page, read from the cached scans in one query.
 *
 * The column holds the reference of the repository that was scanned for the target, and a later
 * scan of another repository does not replace it. A copy of the same bundle in another repository
 * therefore never becomes the source of a skill, so the page keeps pointing at the repository
 * that was pinned first.
 *
 * The report itself is not read here, so a report that cannot be parsed can never take the
 * list down. The target ids are bound one by one, so a page cannot carry a statement of its own.
 */
export async function scannedSourcesOf(sql: Db, targetIds: readonly string[]): Promise<Map<string, string>> {
  const sources = new Map<string, string>()
  if (targetIds.length === 0) return sources
  const placeholders = targetIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows = await sql.query<{ target_id: string; src: string | null }>(
    `SELECT target_id, src FROM scan_cache WHERE target_id IN (${placeholders})`,
    targetIds,
  )
  for (const row of rows) {
    if (row.src !== null && decodeSrc(row.src)?.kind === 'skill') sources.set(row.target_id, row.src)
  }
  return sources
}
