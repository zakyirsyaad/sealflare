import { z } from 'zod'
import { isAddress } from 'viem'
import { AddressSchema, decodeSrc, ScanError, SkillSource } from '@sealflare/shared/schemas'

const Name = z.string().regex(/^[A-Za-z0-9_.-]+$/).refine((value) => value !== '.' && value !== '..')
const Path = SkillSource.shape.path.refine((value) => !/[\u0000-\u001f\u007f]/.test(value) && value.isWellFormed())
const SkillInput = z.object({ kind: z.literal('skill'), owner: Name, repo: Name,
  commit: SkillSource.shape.commit.optional(), branch: z.literal('main').optional(), path: Path.optional() })
export type ScanInput = { kind: 'contract'; address: z.infer<typeof AddressSchema> } | z.infer<typeof SkillInput>

function skill(owner: string, repo: string, path?: string, commit?: string, branch?: 'main'): ScanInput {
  return SkillInput.parse({ kind: 'skill', owner, repo: repo.replace(/\.git$/, ''),
    ...(path === undefined ? {} : { path }), ...(commit === undefined ? {} : { commit: commit.toLowerCase() }),
    ...(branch === undefined ? {} : { branch }) })
}

function githubUrl(text: string): ScanInput {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^?#]+)(?:[?#].*)?$/i.exec(text)
  if (!match) throw Error('Not a GitHub repository URL.')
  // Decode and validate before any URL normalization could erase traversal segments.
  const parts = decodeURIComponent(match[1]!).replace(/\/$/, '').split('/')
  const [owner, repo, marker, revision] = parts
  if (!owner || !repo) throw Error('Missing repository name.')
  if (parts.length === 2) return skill(owner, repo)
  if (marker !== 'tree' || !revision) throw Error('Not a skill folder URL.')
  const path = parts.length === 4 ? undefined : parts.slice(4).join('/')
  if (/^[0-9a-fA-F]{40}$/.test(revision)) return skill(owner, repo, path, revision)
  if (revision === 'main') return skill(owner, repo, path, undefined, 'main')
  throw Error('A pinned commit is required for non-main references.')
}

/** Bare repos use the default branch; explicit main links retain their selected branch. */
export function parseScanInput(text: string): ScanInput {
  try {
    const value = z.string().trim().min(1).max(4096).parse(text)
    const address = AddressSchema.safeParse(value)
    if (address.success) {
      // Lower/upper case are unchecksummed; mixed case must satisfy EIP-55.
      const hex = value.slice(2)
      if (hex !== hex.toLowerCase() && hex !== hex.toUpperCase() && !isAddress(value, { strict: true })) {
        throw Error('Invalid address checksum.')
      }
      return { kind: 'contract', address: address.data }
    }
    if (value.startsWith('gh:')) {
      const decoded = decodeSrc(value)
      if (decoded?.kind !== 'skill') throw Error('Invalid compact skill reference.')
      return SkillInput.parse(decoded)
    }
    return githubUrl(value)
  } catch {
    throw new ScanError('INPUT_NOT_RECOGNIZED', 'That is not a contract address or a repository link.')
  }
}
