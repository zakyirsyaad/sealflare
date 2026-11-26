import { createScanner, suggestVerdict } from '@sealflare/scanner-core'
import type { Guard } from '@sealflare/guard'
import { bundleIdentity, CONSTANTS, type BundleEntry } from '@sealflare/shared/rules'
import { SKILL_CHECK_IDS, SkillSource, encodeSrc, type Check, type Finding, type RepoFetcher } from '@sealflare/shared/schemas'
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

/** What the files outside the bundle produced. */
interface ExtraResult {
  findings: Finding[]
  flagged: Set<string>
  /** A part could not be scanned at all. */
  failed: boolean
  /** A file was too large to be scanned. */
  skipped: number
}

/**
 * The findings of the files outside the bundle, and the checks they flagged.
 *
 * A file that was changed in the work tree is the manifest of the part it is in, so a scan never
 * sees two files with the same path. The findings of that working copy are kept, because the scan
 * of the bundle only saw the committed one.
 */
async function scanExtra(extra: readonly BundleEntry[], manifest: BundleEntry | undefined): Promise<ExtraResult> {
  const { parts, skipped } = partsOf(extra, manifest)
  const findings: Finding[] = []
  const flagged = new Set<string>()
  let failed = false
  for (const part of parts) {
    const working = part.find(entry => entry.path === 'SKILL.md')
    const partManifest = working ?? manifest
    const rest = working === undefined ? part : part.filter(entry => entry !== working)
    const entries = partManifest === undefined ? rest : [partManifest, ...rest]
    try {
      const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })
      for (const finding of report.findings) {
        // The findings of the committed manifest were already reported by the scan of the bundle.
        if (working === undefined && manifest !== undefined && pathOf(finding) === manifest.path) continue
        findings.push(finding)
      }
      for (const check of report.checks) {
        if (check.status === 'flagged') flagged.add(check.id)
      }
    } catch {
      failed = true
    }
  }
  return { findings, flagged, failed, skipped }
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
    // A file that could not be scanned or was not read, and a part that could not be scanned at
    // all, mean that the bundle was not fully checked. A check that did not run is never a pass.
    if ((extra.failed || extra.skipped > 0 || bundle.unread > 0) && check.status === 'passed') return { ...check, status: 'failed' as const }
    return check
  })
  const findings = [...report.findings, ...extra.findings]
  const verdict = await input.guard.checkSkill(bundle.hashed)
  // The link of the target page carries the source when the bundle sits in a GitHub work tree, so
  // the page can be rebuilt from the repository when the cache of the application is gone. The
  // source is checked with the shared schema, so an unusable one never reaches the link.
  const merged = bundle.source === null ? null : SkillSource.safeParse({ ...report.source, ...bundle.source })
  const src = merged !== null && merged.success ? encodeSrc(merged.data) : undefined
  const lines = [
    `Sealflare check for the skill bundle in ${escapeText(input.folder)}`,
    field('Canonical bundle hash', identity.canonicalBundleHash),
    field('Target id', identity.targetId),
    field('Files in the bundle', String(bundle.hashed.length)),
    field('Files outside the bundle', String(bundle.extra.length + bundle.unread)),
    ...(bundle.unread > 0 ? [field('Files outside the bundle that were not read', String(bundle.unread))] : []),
    ...(extra.skipped > 0 ? [field('Files outside the bundle that were not scanned', String(extra.skipped))] : []),
    field('Tier', verdict.tier),
    field('Safe', verdict.safe ? 'yes' : 'no'),
    field('Verified publisher', verdict.publisher ?? 'none'),
    field('Flags', verdict.flags.length > 0 ? verdict.flags.join(', ') : 'none'),
    section('Layer 1 findings', findings.map(finding => bullet(findingLine(finding)))),
    section('Layer 1 checks', checks.map(check => bullet(`${check.id}: ${check.status}`))),
    field('Suggested verdict', suggestVerdict(checks, findings, SKILL_CHECK_IDS)),
    section('Reasons', verdict.reasons.map(bullet)),
    field('Target page', targetLink(identity.targetId, src)),
  ]
  return join(lines)
}
