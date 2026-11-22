import { type Hex, concatBytes, keccak256 } from 'viem'
import { CONSTANTS } from './constants'

export type BundleEntry = {
  /** POSIX path relative to the skill folder, as raw as the source gives it. */
  path: string
  kind: 'file' | 'symlink'
  /** File content, or the link target text for a symlink. Never the content the link points at. */
  bytes: Uint8Array
}

export type BundleErrorCode = 'EMPTY' | 'TOO_MANY_FILES' | 'TOO_LARGE' | 'DUPLICATE_PATH' | 'INVALID_PATH'

export class BundleError extends Error {
  readonly code: BundleErrorCode

  constructor(code: BundleErrorCode, message: string) {
    super(message)
    this.name = 'BundleError'
    this.code = code
  }
}

/** The one file left out of the hash, so a publisher can sign a bundle without changing it. */
export const EXCLUDED_PATH = 'publisher.sig'

const KIND_BYTE = { file: 0, symlink: 1 } as const
const encoder = new TextEncoder()

function isValidPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/')) return false
  if (path.includes('\u0000') || path.includes('\\')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return a.length - b.length
}

function assertWithinLimits(entries: readonly BundleEntry[]): void {
  if (entries.length === 0) throw new BundleError('EMPTY', 'The bundle has no files.')
  if (entries.length > CONSTANTS.MAX_BUNDLE_FILES) {
    throw new BundleError('TOO_MANY_FILES', `The bundle has more than ${CONSTANTS.MAX_BUNDLE_FILES} files.`)
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes.length, 0)
  if (totalBytes > CONSTANTS.MAX_BUNDLE_BYTES) {
    throw new BundleError('TOO_LARGE', `The bundle is larger than ${CONSTANTS.MAX_BUNDLE_BYTES} bytes.`)
  }
}

/**
 * contentHash = keccak256(leaf_0 ‖ … ‖ leaf_n) over entries sorted by the UTF-8 bytes of their path,
 * with leaf = keccak256(keccak256(path) ‖ kindByte ‖ keccak256(bytes)).
 * Bytes are hashed raw. A bundle over the limits is rejected, never truncated.
 */
export function contentHash(entries: readonly BundleEntry[]): Hex {
  const invalid = entries.find((entry) => !isValidPath(entry.path))
  if (invalid) throw new BundleError('INVALID_PATH', `Invalid path in bundle: ${JSON.stringify(invalid.path)}`)

  const included = entries.filter((entry) => entry.path !== EXCLUDED_PATH)
  assertWithinLimits(included)

  const sorted = included
    .map((entry) => ({ entry, pathBytes: encoder.encode(entry.path) }))
    .sort((a, b) => compareBytes(a.pathBytes, b.pathBytes))

  const duplicate = sorted.find((item, i) => i > 0 && item.entry.path === sorted[i - 1]?.entry.path)
  if (duplicate) throw new BundleError('DUPLICATE_PATH', `Duplicate path in bundle: ${duplicate.entry.path}`)

  const leaves = sorted.map(({ entry, pathBytes }) =>
    keccak256(
      concatBytes([keccak256(pathBytes, 'bytes'), Uint8Array.of(KIND_BYTE[entry.kind]), keccak256(entry.bytes, 'bytes')]),
      'bytes',
    ),
  )
  return keccak256(concatBytes(leaves))
}
