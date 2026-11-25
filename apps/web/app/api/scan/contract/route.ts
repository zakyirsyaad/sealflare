import { parseScanInput } from '@sealflare/scanner-core'
import { ScanContractRequest, ScanError } from '@sealflare/shared/schemas'
import { fail, failUnexpected, ok } from '../../../../server/respond'
import { getScanEnvironment } from '../../../../server/scanner'
import { putScan } from '../../../../server/scanStore'
import { takeRateLimit } from '../../../../server/rate'
import { callerOf } from '../../../../server/caller'

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
  try {
    // A scan is counted before it runs, so a caller that scans too often is stopped before the
    // scanner is paid for it.
    const limit = await takeRateLimit('scan', callerOf(request))
    if (!limit.allowed) {
      return fail('RATE_LIMITED', 'Too many scans from this network.', 429, { retryAfterSeconds: limit.retryAfterSeconds })
    }
    // AddressSchema lowercases, which erases the EIP-55 checksum. Parse the text as sent, with the
    // same parser as the Scan screen, so a mistyped mixed-case address is refused on both paths.
    const reference = parseScanInput((body as { address: string }).address)
    if (reference.kind !== 'contract') return fail('INPUT_NOT_RECOGNIZED', 'That is not a contract address.', 400)
    const { scanner, rpc, explorer } = getScanEnvironment()
    const report = await scanner.scanContract(reference.address, { rpc, explorer })
    // The target page shows the findings of this scan, so the report is kept for a short while.
    putScan(report)
    return ok(report)
  } catch (error) {
    if (error instanceof ScanError) return fail(error.code, error.message, STATUS[error.code] ?? 400, error.details)
    return failUnexpected('The scan could not be completed.', error)
  }
}
