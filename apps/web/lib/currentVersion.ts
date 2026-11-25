import { decodeSrc } from '@sealflare/shared/schemas'

/**
 * A link that scans the skill's repository as it is now. The pinned commit of the source is dropped on
 * purpose: the point is to see what the repository holds today, not the version that was rated.
 */
export function scanCurrentVersionHref(src: string | null): string | null {
  if (src === null) return null
  const reference = decodeSrc(src)
  if (reference === null || reference.kind !== 'skill') return null
  const repository = `https://github.com/${reference.owner}/${reference.repo}`
  const target = reference.path === '' ? repository : `${repository}/tree/main/${reference.path}`
  return `/app?q=${encodeURIComponent(target)}`
}
