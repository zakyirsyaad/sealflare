import { bundleIdentity, CONSTANTS } from '@sealflare/shared/rules'
import { decodeSrc, utf8Length, type RepoFetcher } from '@sealflare/shared/schemas'

/**
 * The skill the sandbox reads.
 *
 * The SKILL.md the worker receives is fetched here, from the commit the source names, and never
 * from the client. The bundle is hashed again and compared with the hash the client signed, so a
 * client cannot ask for a run of one bundle and point the worker at another.
 */
export interface SkillDeps {
  fetcher: RepoFetcher
  /** The GitHub token of the service. Without it the skill cannot be read at all. */
  token?: string
}

/** The source of a skill, as it is named in a request. */
export interface SkillReference {
  owner: string
  repo: string
  commit: string
  path: string
}

/** The source does not name a skill, so there is nothing to sandbox. */
export class NotASkill extends Error {
  constructor() {
    super('The sandbox only runs on a skill.')
    this.name = 'NotASkill'
  }
}

/** The bundle at the pinned commit is not the bundle the client signed. */
export class BundleMismatch extends Error {
  constructor() {
    super('The skill at the pinned commit is not the bundle that was signed.')
    this.name = 'BundleMismatch'
  }
}

/** The skill could not be read, so the run cannot start. */
export class SkillUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillUnavailable'
  }
}

/** The SKILL.md is larger than the worker accepts, so the run cannot start. */
export class SkillTooLarge extends Error {
  constructor() {
    super(`The SKILL.md is larger than ${CONSTANTS.MAX_SKILL_MD_BYTES} bytes.`)
    this.name = 'SkillTooLarge'
  }
}

/** The service has no GitHub token, so it cannot read the file of a skill. */
export class NoGitHubToken extends Error {
  constructor() {
    super('The sandbox cannot read a skill without a GitHub token.')
    this.name = 'NoGitHubToken'
  }
}

/** The SKILL.md of a skill, as it is read from the source. */
export interface SkillSource {
  reference: SkillReference
  skillMd: string
}

/** Reads the reference of a run. Only a pinned skill reference can be sandboxed. */
export function readReference(src: string): SkillReference {
  const decoded = decodeSrc(src)
  if (decoded === null || decoded.kind !== 'skill') throw new NotASkill()
  return { owner: decoded.owner, repo: decoded.repo, commit: decoded.commit, path: decoded.path }
}

/**
 * The SKILL.md of the bundle at the pinned commit.
 *
 * The whole folder is fetched, because the hash covers every file of it and not only the
 * manifest. The hash is compared with the one the client signed, and a bundle that does not
 * match is refused.
 */
export async function readSkillMd(deps: SkillDeps, reference: SkillReference, signedHash: string): Promise<string> {
  if (deps.token === undefined) throw new NoGitHubToken()
  let entries
  try {
    entries = await deps.fetcher.fetchBundle(reference)
  } catch {
    throw new SkillUnavailable('The skill could not be fetched.')
  }
  let identity
  try {
    identity = bundleIdentity(entries)
  } catch {
    throw new BundleMismatch()
  }
  if (identity.canonicalBundleHash.toLowerCase() !== signedHash.toLowerCase()) throw new BundleMismatch()

  const manifest = entries.find(entry => entry.path === 'SKILL.md' && entry.kind === 'file')
  if (manifest === undefined) throw new BundleMismatch()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(manifest.bytes)
  } catch {
    throw new BundleMismatch()
  }
  if (utf8Length(text) > CONSTANTS.MAX_SKILL_MD_BYTES) throw new SkillTooLarge()
  return text
}
