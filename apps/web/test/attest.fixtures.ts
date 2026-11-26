import { FLAGS, canonicalBundleHash, targetIdOfContract, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanReport } from '@sealflare/shared/schemas'

export const address = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
export const targetId = targetIdOfContract(address)
/** The word `Core.attest` takes for the contract: the address in the last twenty bytes. */
export const word = `0x${'0'.repeat(24)}${address.slice(2)}` as const
export const codehash = `0x${'22'.repeat(32)}` as const
export const txHash = `0x${'ab'.repeat(32)}` as const
export const CORE = '0x1000000000000000000000000000000000000001'

const CHECKS = [
  { id: 'source_verified', status: 'passed' },
  { id: 'admin_functions', status: 'passed' },
  { id: 'proxy_eip1967', status: 'passed' },
  { id: 'proxy_beacon', status: 'passed' },
  { id: 'proxy_eip1167', status: 'passed' },
  { id: 'delegatecall_opcode', status: 'passed' },
  { id: 'dry_run', status: 'passed' },
] as const

export const unverified = {
  flag: 'UNVERIFIED_SOURCE',
  checkId: 'source_verified',
  title: 'The source is not verified',
  location: 'explorer',
  excerpt: 'the contract is not verified on the explorer',
}

export const hiddenMint = {
  flag: 'HIDDEN_MINT',
  checkId: 'admin_functions',
  title: 'The owner can mint',
  location: 'owner.mint',
  excerpt: 'function mint(address to)',
}

/** A contract scan holding the given findings. The flags and the checks follow from them. */
export function contractScan(findings: Record<string, unknown>[] = [unverified]) {
  const flagged = new Set(findings.map(finding => finding.checkId))
  const flags = findings.reduce((bits, finding) => bits | FLAGS[finding.flag as keyof typeof FLAGS], 0)
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'SMART_CONTRACT',
    targetId,
    source: { kind: 'contract', address, codehash, blockNumber: '52000000' },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: CHECKS.map(check => ({ ...check, status: flagged.has(check.id) ? 'flagged' : check.status })),
    findings,
    flags,
    suggestedVerdict: findings.length === 0 ? 'SAFE' : 'CAUTION',
  })
}

export const scan = () => contractScan([unverified])
export const twoFindingScan = () => contractScan([unverified, hiddenMint])
export const cleanScan = () => contractScan([])

const CONTENT = `0x${'33'.repeat(32)}` as const
export const bundle = canonicalBundleHash(CONTENT, address)
export const skillId = targetIdOfSkill(bundle)

/** A scan of a skill bundle that found nothing. Another content hash is another bundle. */
export function skillScan(contentHash: `0x${string}` = CONTENT) {
  return ScanReport.parse({
    schemaVersion: 1,
    targetType: 'AI_SKILL_BUNDLE',
    targetId: targetIdOfSkill(canonicalBundleHash(contentHash, address)),
    source: {
      kind: 'skill',
      repo: 'sealflare/guard',
      commit: 'a'.repeat(40),
      path: 'skills/guard',
      contentHash,
      manifestPublisher: address,
      canonicalBundleHash: canonicalBundleHash(contentHash, address),
      fileCount: 3,
      totalBytes: 2048,
    },
    scannedAt: '2026-11-25T03:00:00.000Z',
    checks: [{ id: 'bundle_hash', status: 'passed' }],
    findings: [],
    flags: 0,
    suggestedVerdict: null,
  })
}
