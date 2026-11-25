import { decodeSrc } from '@sealflare/shared/schemas'

/**
 * A link that scans the skill's repository as it is now. The pinned commit of the source is dropped on
 * purpose: the point is to see what the repository holds today, not the version that was rated.
 *
 * The link names the repository, not a branch: the default branch of a repository is not always
 * `main`, and a link that names a branch the repository does not have scans nothing. The scanner
 * resolves the default branch itself and lists the skill folders it finds.
 */
export function scanCurrentVersionHref(src: string | null): string | null {
  if (src === null) return null
  const reference = decodeSrc(src)
  if (reference === null || reference.kind !== 'skill') return null
  const repository = `https://github.com/${reference.owner}/${reference.repo}`
  return `/app?q=${encodeURIComponent(repository)}`
}
