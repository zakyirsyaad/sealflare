import { type Hex, concatBytes, keccak256 } from 'viem'
import type { Address } from 'viem'
import { CONSTANTS } from './constants'
import { canonicalBundleHash, targetIdOfSkill } from './ids'
import { readManifestPublisher } from './manifest'

export type BundleEntry = {
  /** POSIX path relative to the skill folder, as raw as the source gives it. */
  path: string
  kind: 'file' | 'symlink'
  /** File content, or the link target text for a symlink. Never the content the link points at. */
  bytes: Uint8Array
}

export type BundleErrorCode = 'EMPTY' | 'TOO_MANY_FILES' | 'TOO_LARGE' | 'DUPLICATE_PATH' | 'INVALID_PATH' | 'INVALID_ENTRY'

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
/** Room for a signature and a little framing. The file is outside the hash, so it must stay small. */
export const MAX_PUBLISHER_SIG_BYTES = 1024

const KIND_BYTE = { file: 0, symlink: 1 } as const
const encoder = new TextEncoder()

function isValidPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/')) return false
  if (path.includes('\u0000') || path.includes('\\')) return false
  // A lone surrogate has no UTF-8 form: two different paths would encode to the same bytes.
  if (!path.isWellFormed()) return false
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
  const malformed = entries.find(
    (entry) => typeof entry.path !== 'string' || !(entry.kind in KIND_BYTE) || !(entry.bytes instanceof Uint8Array),
  )
  if (malformed) throw new BundleError('INVALID_ENTRY', 'A bundle entry needs a path, a kind of file or symlink, and bytes.')

  const invalid = entries.find((entry) => !isValidPath(entry.path))
  if (invalid) throw new BundleError('INVALID_PATH', `Invalid path in bundle: ${JSON.stringify(invalid.path)}`)

  const signature = entries.find((entry) => entry.path === EXCLUDED_PATH)
  if (signature && signature.kind !== 'file') throw new BundleError('INVALID_PATH', `${EXCLUDED_PATH} must be a regular file.`)
  if (signature && signature.bytes.length > MAX_PUBLISHER_SIG_BYTES) {
    throw new BundleError('TOO_LARGE', `${EXCLUDED_PATH} is larger than ${MAX_PUBLISHER_SIG_BYTES} bytes.`)
  }

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

export const MANIFEST_PATH = 'SKILL.md'

export type BundleIdentity = { contentHash: Hex; manifestPublisher: Address; canonicalBundleHash: Hex; targetId: Hex }

/**
 * Everything that identifies a skill bundle, from its entries alone. The publisher comes from the
 * root SKILL.md when that is a regular file; a symlink or a nested SKILL.md does not count.
 */
export function bundleIdentity(entries: readonly BundleEntry[]): BundleIdentity {
  const content = contentHash(entries)
  const manifest = entries.find((entry) => entry.path === MANIFEST_PATH && entry.kind === 'file')
  const manifestPublisher = readManifestPublisher(manifest?.bytes ?? new Uint8Array())
  const canonical = canonicalBundleHash(content, manifestPublisher)
  return { contentHash: content, manifestPublisher, canonicalBundleHash: canonical, targetId: targetIdOfSkill(canonical) }
}
