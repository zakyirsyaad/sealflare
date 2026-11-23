import { z } from 'zod'
import { BundleError, bundleIdentity, EXCLUDED_PATH, FLAGS, type BundleEntry } from '@sealflare/shared/rules'
import { Check, Finding, ScanError, ScanReport, SkillSource, SKILL_CHECK_IDS,
  type RepoFetcher, type RepoRef, type SkillRef } from '@sealflare/shared/schemas'
import { suggestVerdict } from '../verdict'
import { skillChecks, type SkillCheck } from './checks/index'

const NAME = z.string().regex(/^[A-Za-z0-9_.-]+$/).refine((value) => value !== '.' && value !== '..')
const REFERENCE = z.object({ owner: NAME, repo: NAME, commit: SkillSource.shape.commit.optional(),
  path: SkillSource.shape.path.optional() })

async function resolveRef(ref: RepoRef & { path?: string }, repo: RepoFetcher): Promise<SkillRef> {
  const input = REFERENCE.safeParse(ref)
  if (!input.success) throw new ScanError('INPUT_NOT_RECOGNIZED', 'Invalid skill reference.')
  const value = input.data
  if (value.path !== undefined && value.commit !== undefined) return { ...value, path: value.path, commit: value.commit }
  const listing = await repo.listSkillFolders(value)
  const commit = SkillSource.shape.commit.safeParse(listing.commit)
  if (!commit.success || (value.commit !== undefined && value.commit !== listing.commit)) {
    throw new ScanError('NO_SKILL_FOUND', 'Repository did not resolve to the requested commit.')
  }
  if (value.path === undefined && listing.folders.length === 0) throw new ScanError('NO_SKILL_FOUND', 'No skill folder found.')
  if (value.path === undefined && listing.folders.length > 1) {
    throw new ScanError('MULTIPLE_SKILL_FOLDERS', 'Choose a skill folder.', { folders: [...listing.folders] })
  }
  const path = SkillSource.shape.path.safeParse(value.path ?? listing.folders[0])
  if (!path.success) throw new ScanError('NO_SKILL_FOUND', 'Invalid skill folder path.')
  return { owner: value.owner, repo: value.repo, commit: commit.data, path: path.data }
}

function identify(entries: readonly BundleEntry[]) {
  const identity = bundleIdentity(entries)
  if (!entries.some((entry) => entry.path === 'SKILL.md' && entry.kind === 'file')) {
    throw new ScanError('NO_SKILL_FOUND', 'A regular SKILL.md file is required.')
  }
  return identity
}

function mapBundleError(error: unknown): never {
  if (!(error instanceof BundleError)) throw error
  const code = error.code === 'TOO_MANY_FILES' || error.code === 'TOO_LARGE' ? 'BUNDLE_TOO_LARGE' : 'NO_SKILL_FOUND'
  throw new ScanError(code, code === 'BUNDLE_TOO_LARGE' ? 'Skill bundle exceeds the size limit.' : 'Invalid skill bundle.')
}

function runCheck(id: Check['id'], run: SkillCheck, entries: readonly BundleEntry[]) {
  try {
    const result = run(entries)
    const check = Check.parse(result.check)
    const findings = z.array(Finding).parse(result.findings)
    if (check.id !== id || findings.some((finding) => finding.checkId !== id)) throw new Error('Mismatched check id')
    if ((check.status === 'flagged') !== (findings.length > 0)) throw new Error('Inconsistent check result')
    return { check, findings }
  } catch {
    return { check: { id, status: 'failed' as const }, findings: [] }
  }
}

export async function scanSkill(
  ref: RepoRef & { path?: string }, deps: { repo: RepoFetcher; now?: () => Date },
): Promise<ScanReport> {
  try {
    const pinned = await resolveRef(ref, deps.repo)
    const entries = await deps.repo.fetchBundle(pinned)
    const { targetId, ...identity } = identify(entries)
    const results = skillChecks().map(({ id, run }) => runCheck(id, run, entries))
    const checks: Check[] = [{ id: 'bundle_hash', status: 'passed' }, ...results.map(({ check }) => check)]
    const findings = results.flatMap((result) => result.findings)
    const included = entries.filter((entry) => entry.path !== EXCLUDED_PATH)
    return ScanReport.parse({
      schemaVersion: 1, targetType: 'AI_SKILL_BUNDLE', targetId,
      source: { kind: 'skill', repo: `${pinned.owner}/${pinned.repo}`, commit: pinned.commit, path: pinned.path,
        ...identity, fileCount: included.length, totalBytes: included.reduce((sum, entry) => sum + entry.bytes.length, 0) },
      scannedAt: (deps.now?.() ?? new Date()).toISOString(), checks, findings,
      flags: findings.reduce((bits, finding) => bits | FLAGS[finding.flag], 0),
      suggestedVerdict: suggestVerdict(checks, findings, SKILL_CHECK_IDS),
    })
  } catch (error) {
    return mapBundleError(error)
  }
}
