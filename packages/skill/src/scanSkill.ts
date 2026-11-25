import { createScanner, suggestVerdict } from '@sealflare/scanner-core'
import type { Guard } from '@sealflare/guard'
import { bundleIdentity, CONSTANTS, type BundleEntry } from '@sealflare/shared/rules'
import { SKILL_CHECK_IDS, type Check, type Finding, type RepoFetcher } from '@sealflare/shared/schemas'
import { readBundle } from './bundle'
import { bullet, escapeText, field, join, section, targetLink } from './output'

/** The commit of a local folder is not a commit, but the report needs the shape of one. */
const LOCAL_COMMIT = '0'.repeat(40)

/** The Layer 1 checks of a bundle that already sits on this machine. No network is used. */
export function localRepo(entries: readonly BundleEntry[]): RepoFetcher {
  return {
    listSkillFolders: async () => ({ commit: LOCAL_COMMIT, folders: [''] }),
    fetchBundle: async () => [...entries],
  }
}

function findingLine(finding: { title: string; location: string; excerpt: string; flag: string }): string {
  return `${finding.title} (${finding.flag}) at ${finding.location}: ${finding.excerpt}`
}

/**
 * The files outside the bundle, cut into parts that a scan can take.
 *
 * A scan applies the limits of a bundle to the files it gets, so the files outside the bundle are
 * scanned in parts. Each part holds the manifest of the bundle, because a scan needs one, and the
 * findings of the manifest are left out, because the scan of the bundle already reported them.
 */
function partsOf(extra: readonly BundleEntry[], manifest: BundleEntry | undefined): { parts: BundleEntry[][]; skipped: number } {
  const room = manifest === undefined ? CONSTANTS.MAX_BUNDLE_BYTES : CONSTANTS.MAX_BUNDLE_BYTES - manifest.bytes.length
  const files = manifest === undefined ? CONSTANTS.MAX_BUNDLE_FILES : CONSTANTS.MAX_BUNDLE_FILES - 1
  const parts: BundleEntry[][] = []
  let current: BundleEntry[] = []
  let bytes = 0
  let skipped = 0
  for (const entry of extra) {
    if (entry.bytes.length > room) {
      skipped += 1
      continue
    }
    if (current.length >= files || bytes + entry.bytes.length > room) {
      if (current.length > 0) parts.push(current)
      current = []
      bytes = 0
    }
    current.push(entry)
    bytes += entry.bytes.length
  }
  if (current.length > 0) parts.push(current)
  return { parts, skipped }
}

/** The path a finding points at, without the line at the end. */
function pathOf(finding: Finding): string {
  const cut = finding.location.lastIndexOf(':')
  return cut < 0 ? finding.location : finding.location.slice(0, cut)
}

/** The findings of the files outside the bundle, and the checks they flagged. */
async function scanExtra(extra: readonly BundleEntry[], manifest: BundleEntry | undefined): Promise<{ findings: Finding[]; flagged: Set<string>; failed: boolean }> {
  const { parts } = partsOf(extra, manifest)
  const findings: Finding[] = []
  const flagged = new Set<string>()
  let failed = false
  for (const part of parts) {
    const entries = manifest === undefined ? part : [manifest, ...part]
    try {
      const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })
      for (const finding of report.findings) {
        if (manifest !== undefined && pathOf(finding) === manifest.path) continue
        findings.push(finding)
      }
      for (const check of report.checks) {
        if (check.status === 'flagged') flagged.add(check.id)
      }
    } catch {
      failed = true
    }
  }
  return { findings, flagged, failed }
}

/**
 * The report of a skill bundle: the hash of the bundle, the findings of Layer 1 and the status
 * that the registry gives it.
 *
 * The bundle is never executed. Its files are only read as text, and every text of the bundle that
 * is printed passes through `escapeText`, so a bundle cannot write to the terminal.
 *
 * The hash covers the files of the bundle only: the committed files of a git work tree, or every
 * file of a folder outside git. The files that are not in the bundle are scanned as well, so a
 * finding in a file that is not committed is never hidden, but those files never change the hash or
 * the id.
 */
export async function scanSkillReport(input: { folder: string; guard: Guard }): Promise<string> {
  const bundle = await readBundle(input.folder)
  const identity = bundleIdentity(bundle.hashed)
  const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(bundle.hashed) })
  const manifest = bundle.hashed.find(entry => entry.path === 'SKILL.md')
  const extra = await scanExtra(bundle.extra, manifest)
  const checks: Check[] = report.checks.map(check => {
    if (extra.flagged.has(check.id)) return { ...check, status: 'flagged' as const }
    if (extra.failed && check.status === 'passed') return { ...check, status: 'failed' as const }
    return check
  })
  const findings = [...report.findings, ...extra.findings]
  const verdict = await input.guard.checkSkill(bundle.hashed)
  const lines = [
    `Sealflare check for the skill bundle in ${escapeText(input.folder)}`,
    field('Canonical bundle hash', identity.canonicalBundleHash),
    field('Target id', identity.targetId),
    field('Files in the bundle', String(bundle.hashed.length)),
    field('Files outside the bundle', String(bundle.extra.length + bundle.unread)),
    ...(bundle.unread > 0 ? [field('Files outside the bundle that were not read', String(bundle.unread))] : []),
    field('Tier', verdict.tier),
    field('Safe', verdict.safe ? 'yes' : 'no'),
    field('Verified publisher', verdict.publisher ?? 'none'),
    field('Flags', verdict.flags.length > 0 ? verdict.flags.join(', ') : 'none'),
    section('Layer 1 findings', findings.map(finding => bullet(findingLine(finding)))),
    section('Layer 1 checks', checks.map(check => bullet(`${check.id}: ${check.status}`))),
    field('Suggested verdict', suggestVerdict(checks, findings, SKILL_CHECK_IDS)),
    section('Reasons', verdict.reasons.map(bullet)),
    field('Target page', targetLink(identity.targetId)),
  ]
  return join(lines)
}
