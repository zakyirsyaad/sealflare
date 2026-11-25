import { parseScanInput } from '@sealflare/scanner-core'
import { ScanError, ScanSkillRequest } from '@sealflare/shared/schemas'
import { fail, ok } from '../../../../server/respond'
import { getScanEnvironment } from '../../../../server/scanner'

const STATUS: Record<string, number> = {
  INPUT_NOT_RECOGNIZED: 400,
  NO_CODE_AT_ADDRESS: 404,
  REPO_NOT_PUBLIC: 404,
  NO_SKILL_FOUND: 404,
  MULTIPLE_SKILL_FOLDERS: 409,
  BUNDLE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  RPC_UNAVAILABLE: 503,
  RESULT_NOT_CACHED: 404,
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = ScanSkillRequest.safeParse(body)
  if (!parsed.success) return fail('BAD_REQUEST', 'The request is not a valid skill scan.', 400)
  let reference: ReturnType<typeof parseScanInput>
  try {
    reference = parseScanInput(parsed.data.url)
  } catch (error) {
    if (error instanceof ScanError) return fail(error.code, error.message, STATUS[error.code] ?? 400, error.details)
    return fail('INPUT_NOT_RECOGNIZED', 'That is not a repository link.', 400)
  }
  if (reference.kind !== 'skill') return fail('INPUT_NOT_RECOGNIZED', 'That is not a repository link.', 400)
  const path = parsed.data.path ?? reference.path
  try {
    const { scanner, repo } = getScanEnvironment()
    const report = await scanner.scanSkill(
      {
        owner: reference.owner,
        repo: reference.repo,
        ...(reference.commit === undefined ? {} : { commit: reference.commit }),
        ...(reference.branch === undefined ? {} : { branch: reference.branch }),
        ...(path === undefined ? {} : { path }),
      },
      { repo },
    )
    return ok(report)
  } catch (error) {
    if (error instanceof ScanError) return fail(error.code, error.message, STATUS[error.code] ?? 400, error.details)
    return fail('INTERNAL', 'The scan could not be completed.', 500)
  }
}
