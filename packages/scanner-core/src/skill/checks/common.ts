import { CONSTANTS, type BundleEntry, type FlagName } from '@sealflare/shared/rules'
import type { Check, CheckId, Finding } from '@sealflare/shared/schemas'
import { decodeText, excerptAt, lineOf } from '../text'

export type SkillCheck = (entries: readonly BundleEntry[]) => { check: Check; findings: Finding[] }
export type TextMatch = { index: number; length: number }
export type TextMatcher = (text: string, path: string) => TextMatch[]

/** Match the original decoded text, preserving offsets and leading BOMs. No file is executed. */
export function textCheck(id: CheckId, flag: FlagName, title: string, match: TextMatcher): SkillCheck {
  return (entries) => {
    const files = entries.filter((entry) => entry.kind === 'file')
    const decoded = files.map((entry) => ({ path: entry.path, text: decodeText(entry.bytes) }))
    const findings = decoded.flatMap(({ path, text }) => text === null ? [] :
      match(text, path).map(({ index, length }) => ({
        flag, checkId: id, title, location: locationAt(path, lineOf(text, index)),
        excerpt: boundedExcerpt(excerptAt(text, index, length)),
      })))
    const incomplete = decoded.some(({ text }) => text === null)
    return { check: { id, status: findings.length ? 'flagged' : incomplete ? 'skipped' : 'passed' }, findings }
  }
}

function locationAt(path: string, line: number): string {
  const suffix = `:${line}`
  return path.length + suffix.length <= 200 ? `${path}${suffix}` : `${path.slice(0, 197 - suffix.length)}...${suffix}`
}

// excerptAt limits UTF-16 characters; the frozen finding schema separately limits UTF-8 bytes.
function boundedExcerpt(excerpt: string): string {
  let result = ''
  for (const character of excerpt) {
    if (new TextEncoder().encode(result + character).length > CONSTANTS.SHORT_PROOF_MAX_BYTES) break
    result += character
  }
  return result
}

export function matches(text: string, pattern: RegExp): TextMatch[] {
  return [...text.matchAll(pattern)].map((match) => ({ index: match.index, length: match[0].length }))
}
