import { ScanContractRequest, ScanError } from '@sealflare/shared/schemas'
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
  const parsed = ScanContractRequest.safeParse(body)
  if (!parsed.success) return fail('BAD_REQUEST', 'The request is not a valid contract scan.', 400)
  const { scanner, rpc, explorer } = getScanEnvironment()
  try {
    const report = await scanner.scanContract(parsed.data.address, { rpc, explorer })
    return ok(report)
  } catch (error) {
    if (error instanceof ScanError) return fail(error.code, error.message, STATUS[error.code] ?? 400, error.details)
    return fail('INTERNAL', 'The scan could not be completed.', 500)
  }
}
