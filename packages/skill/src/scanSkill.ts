import { createScanner } from '@sealflare/scanner-core'
import type { Guard } from '@sealflare/guard'
import { bundleIdentity, type BundleEntry } from '@sealflare/shared/rules'
import type { RepoFetcher } from '@sealflare/shared/schemas'
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
 * The report of a skill bundle: the hash of the bundle, the findings of Layer 1 and the status
 * that the registry gives it.
 *
 * The bundle is never executed. Its files are only read as text, and every text of the bundle that
 * is printed passes through `escapeText`, so a bundle cannot write to the terminal.
 *
 * The hash covers the files of the bundle only: the tracked files of a git work tree, or every file
 * of a folder outside git. The files that are not in the bundle are scanned as well, so a finding in
 * a file that is not committed is never hidden, but those files never change the hash or the id.
 */
export async function scanSkillReport(input: { folder: string; guard: Guard }): Promise<string> {
  const bundle = await readBundle(input.folder)
  const entries = [...bundle.hashed, ...bundle.extra]
  const identity = bundleIdentity(bundle.hashed)
  const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })
  const verdict = await input.guard.checkSkill(bundle.hashed)
  const lines = [
    `Sealflare check for the skill bundle in ${escapeText(input.folder)}`,
    field('Canonical bundle hash', identity.canonicalBundleHash),
    field('Target id', identity.targetId),
    field('Files in the bundle', String(bundle.hashed.length)),
    field('Files outside the bundle', String(bundle.extra.length + bundle.unread)),
    ...(bundle.unread > 0 ? [field('Files outside the bundle that were read', String(bundle.extra.length))] : []),
    field('Tier', verdict.tier),
    field('Safe', verdict.safe ? 'yes' : 'no'),
    field('Verified publisher', verdict.publisher ?? 'none'),
    field('Flags', verdict.flags.length > 0 ? verdict.flags.join(', ') : 'none'),
    section('Layer 1 findings', report.findings.map(finding => bullet(findingLine(finding)))),
    section('Layer 1 checks', report.checks.map(check => bullet(`${check.id}: ${check.status}`))),
    field('Suggested verdict', report.suggestedVerdict ?? 'none'),
    section('Reasons', verdict.reasons.map(bullet)),
    field('Target page', targetLink(identity.targetId)),
  ]
  return join(lines)
}
