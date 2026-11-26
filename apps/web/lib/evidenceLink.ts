const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/**
 * A link a browser may follow for the evidence behind a URI, or null.
 *
 * The URI comes from the chain, so it is never trusted as a link: only `ipfs://` and `https://`
 * are followed, and anything else (a `javascript:` URI, for one) has no link.
 */
export function evidenceHref(uri: string | null | undefined): string | null {
  if (uri === null || uri === undefined) return null
  const value = uri.trim()
  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//, '')
    const clean = /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(path) && !path.split('/').some(part => part === '..' || part === '.')
    return clean ? `${IPFS_GATEWAY}${path}` : null
  }
  if (!value.startsWith('https://')) return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}
