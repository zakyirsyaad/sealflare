import { createScanner } from '@sealflare/scanner-core'
import type { Guard } from '@sealflare/guard'
import { bundleIdentity, type BundleEntry } from '@sealflare/shared/rules'
import type { RepoFetcher } from '@sealflare/shared/schemas'
import { readFolder } from './bundle'
import { bullet, field, join, section, targetLink } from './output'

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
 * The bundle is never executed. Its files are only read as text.
 */
export async function scanSkillReport(input: { folder: string; guard: Guard }): Promise<string> {
  const entries = await readFolder(input.folder)
  const identity = bundleIdentity(entries)
  const report = await createScanner().scanSkill({ owner: 'local', repo: 'local' }, { repo: localRepo(entries) })
  const verdict = await input.guard.checkSkill(entries)
  const lines = [
    `Sealflare check for the skill bundle in ${input.folder}`,
    field('Canonical bundle hash', identity.canonicalBundleHash),
    field('Target id', identity.targetId),
    field('Files', String(entries.length)),
    field('Tier', verdict.tier),
    field('Safe', verdict.safe ? 'yes' : 'no'),
    field('Publisher', verdict.publisher ?? 'none'),
    field('Flags', verdict.flags.length > 0 ? verdict.flags.join(', ') : 'none'),
    section('Layer 1 findings', report.findings.map(finding => bullet(findingLine(finding)))),
    section('Layer 1 checks', report.checks.map(check => bullet(`${check.id}: ${check.status}`))),
    field('Suggested verdict', report.suggestedVerdict ?? 'none'),
    section('Reasons', verdict.reasons.map(bullet)),
    field('Target page', targetLink(identity.targetId)),
  ]
  return join(lines)
}
