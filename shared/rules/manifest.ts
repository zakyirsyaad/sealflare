import type { Address } from 'viem'
import { parse } from 'yaml'
import { ZERO_ADDRESS } from './ids'

export const MANIFEST_PUBLISHER_KEY = 'sealflare-publisher'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const FENCE = '---'

function frontmatterOf(text: string): string | null {
  const lines = text.split(/\r?\n/)
  if (lines[0] !== FENCE) return null
  const end = lines.indexOf(FENCE, 1)
  return end === -1 ? null : lines.slice(1, end).join('\n')
}

/**
 * Publisher address a skill declares for itself: `metadata.sealflare-publisher` in the YAML
 * frontmatter of the root SKILL.md. Anything absent, malformed or ambiguous is the zero address,
 * which means the bundle has no claimable publisher.
 */
export function readManifestPublisher(skillMd: Uint8Array): Address {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(skillMd)
    const frontmatter = frontmatterOf(text)
    if (frontmatter === null) return ZERO_ADDRESS
    // The failsafe schema keeps every scalar a string, so an unquoted 0x… is not read as a number.
    const document: unknown = parse(frontmatter, { schema: 'failsafe' })
    const metadata = (document as { metadata?: unknown } | null)?.metadata
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return ZERO_ADDRESS
    const value = (metadata as Record<string, unknown>)[MANIFEST_PUBLISHER_KEY]
    if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) return ZERO_ADDRESS
    return value.toLowerCase() as Address
  } catch {
    return ZERO_ADDRESS
  }
}
