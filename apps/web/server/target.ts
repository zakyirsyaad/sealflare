import 'server-only'
import type { Hex } from 'viem'
import { Bytes32Schema, decodeSrc, encodeSrc, TargetDetail, type AttestationRow, type ScanReport, type SignalGroup } from '@sealflare/shared/schemas'
import { ZERO_ADDRESS, type TrustTier } from '@sealflare/shared/rules'
import { getChainReader, type ChainReader, type CoreAttestation, type CoreTarget, type EvidenceRow } from './chain'
import { getScan, putScan } from './scanStore'
import { getScanEnvironment } from './scanner'

const ZERO_HASH = `0x${'0'.repeat(64)}` as const

/** The bytes32 of a contract target carries the address in its last twenty bytes. */
export function addressOf(target: CoreTarget): Hex {
  return `0x${target.target.slice(-40)}` as Hex
}

function emptyGroup(): SignalGroup {
  return { votes: { safe: 0, caution: 0, danger: 0 }, weight: { safe: 0, caution: 0, danger: 0 }, flags: 0 }
}

/**
 * The signal is never collapsed into one number. New Agent IDs carry weight 1 and experienced
 * Guardians carry weight 2 or more, so the two groups are counted apart.
 */
export function groupOf(attestations: readonly CoreAttestation[]): SignalGroup {
  const group = emptyGroup()
  for (const attestation of attestations) {
    const verdict = attestation.verdict.toLowerCase() as 'safe' | 'caution' | 'danger'
    group.votes[verdict] += 1
    group.weight[verdict] += attestation.weight
    group.flags |= attestation.flags
  }
  return group
}

export function signalOf(attestations: readonly CoreAttestation[]): { newIds: SignalGroup; guardians: SignalGroup } {
  return {
    newIds: groupOf(attestations.filter(attestation => attestation.weight <= 1)),
    guardians: groupOf(attestations.filter(attestation => attestation.weight >= 2)),
  }
}

/** Joins the votes of Core with the evidence that only the event log carries. */
export function attestationRows(attestations: readonly CoreAttestation[], evidence: readonly EvidenceRow[]): AttestationRow[] {
  const byIndex = new Map(evidence.map(row => [row.index, row]))
  return attestations.map((attestation, index) => {
    const found = byIndex.get(index)
    return {
      index,
      guardian: attestation.guardian,
      verdict: attestation.verdict,
      flags: attestation.flags,
      weight: attestation.weight,
      safeOrdinal: attestation.safeOrdinal,
      shortProof: found?.shortProof ?? '',
      evidenceURI: found?.evidenceURI ?? '',
      txHash: found?.txHash ?? ZERO_HASH,
      at: new Date(attestation.timestamp * 1000).toISOString(),
      settled: attestation.settled,
      castDuringDispute: attestation.castDuringDispute,
    }
  })
}

function lastVoteAt(attestations: readonly CoreAttestation[]): string | null {
  const newest = attestations.reduce((max, attestation) => Math.max(max, attestation.timestamp), 0)
  return newest === 0 ? null : new Date(newest * 1000).toISOString()
}

function voteCounts(attestations: readonly CoreAttestation[]): { safe: number; caution: number; danger: number } {
  return {
    safe: attestations.filter(attestation => attestation.verdict === 'SAFE').length,
    caution: attestations.filter(attestation => attestation.verdict === 'CAUTION').length,
    danger: attestations.filter(attestation => attestation.verdict === 'DANGER').length,
  }
}

export type DetailInput = {
  targetId: Hex
  target: CoreTarget | null
  tier: TrustTier
  attestations: readonly CoreAttestation[]
  scan: ScanReport | null
  bond: bigint
  src: string | null
}

/** Builds the read model of a target. The tier is the one Core returned, never a recomputed one. */
export function buildDetail(input: DetailInput): TargetDetail {
  const { target, scan } = input
  const isContract = (target?.targetType ?? scan?.targetType ?? 'SMART_CONTRACT') === 'SMART_CONTRACT'
  const label = isContract
    ? target
      ? addressOf(target)
      : (scan?.source.kind === 'contract' ? scan.source.address : input.targetId)
    : (scan?.source.kind === 'skill' ? scan.source.repo : input.targetId)
  const src = isContract
    ? target
      ? addressOf(target)
      : (scan?.source.kind === 'contract' ? scan.source.address : null)
    : (scan
        ? encodeSrc(scan.source)
        : (decodeSrc(input.src ?? '')?.kind === 'skill' ? input.src : null))
  const counts = voteCounts(input.attestations)
  return {
    targetId: input.targetId,
    targetType: isContract ? 'SMART_CONTRACT' : 'AI_SKILL_BUNDLE',
    label,
    src,
    tier: input.tier,
    safe: counts.safe,
    caution: counts.caution,
    danger: counts.danger,
    publisherRole: target?.publisherRole ?? 'NONE',
    bond: input.bond.toString(),
    lastVoteAt: lastVoteAt(input.attestations),
    publisher: target && target.publisher !== ZERO_ADDRESS ? target.publisher : null,
    // A contract pins its code hash, a skill pins the canonical hash of its bundle.
    pinnedCodehash: target
      ? isContract
        ? target.pinnedCodehash
        : target.target
      : (scan?.source.kind === 'skill' ? scan.source.canonicalBundleHash : ZERO_HASH),
    hasDelegatecall: target?.hasDelegatecall ?? false,
    activeFlags: target?.activeFlags ?? 0,
    signal: signalOf(input.attestations),
    activeChallengeId: target && target.activeChallengeId > 0n ? target.activeChallengeId.toString() : null,
    attestationCount: input.attestations.length,
    scan,
    sandbox: null,
  }
}

/** The scan of this target, either the cached one or a fresh one for the given source. */
export async function loadScan(targetId: Hex, src: string | null): Promise<ScanReport | null> {
  const cached = getScan(targetId)
  if (cached) return cached
  if (src === null) return null
  const reference = decodeSrc(src)
  if (reference === null) return null
  try {
    const { scanner, rpc, explorer, repo } = getScanEnvironment()
    const report =
      reference.kind === 'contract'
        ? await scanner.scanContract(reference.address, { rpc, explorer })
        : await scanner.scanSkill(
            { owner: reference.owner, repo: reference.repo, commit: reference.commit, path: reference.path },
            { repo },
          )
    putScan(report)
    return report
  } catch {
    // A scan that fails leaves the page without findings. It never turns into a safe verdict.
    return null
  }
}

export type TargetPageData = {
  targetId: string
  detail: TargetDetail | null
  attestations: AttestationRow[]
  scan: ScanReport | null
  src: string | null
  blocksBehind: number | null
  unbondingAt: number | null
  versionChanged: boolean
  failed: boolean
}

async function readChain(reader: ChainReader, targetId: Hex) {
  const head = await reader.head()
  const target = await reader.target(targetId)
  const tier = target ? await reader.tier(targetId) : 'UNRATED'
  const attestations = target ? await reader.attestations(targetId, target.attestationCount) : []
  const evidence = target ? await reader.evidence(targetId) : []
  const bond =
    target && target.publisher !== ZERO_ADDRESS ? await reader.bond(targetId, target.publisher) : null
  return { head, target, tier, attestations, evidence, bond }
}

/**
 * Everything the target page shows. The chain is the only source of the tier, the votes and the
 * publisher; the scan only adds the findings of the current version.
 */
export async function loadTarget(targetId: string, src: string | null): Promise<TargetPageData> {
  const parsedId = Bytes32Schema.safeParse(targetId)
  const empty: TargetPageData = {
    targetId,
    detail: null,
    attestations: [],
    scan: null,
    src,
    blocksBehind: null,
    unbondingAt: null,
    versionChanged: false,
    failed: false,
  }
  if (!parsedId.success) return { ...empty, failed: true }
  const id = parsedId.data
  let chain: Awaited<ReturnType<typeof readChain>>
  try {
    chain = await readChain(getChainReader(), id)
  } catch {
    return { ...empty, failed: true }
  }
  const scan = await loadScan(id, src)
  const versionChanged = scan !== null && scan.targetId.toLowerCase() !== id.toLowerCase()
  const rows = attestationRows(chain.attestations, chain.evidence)
  const built = buildDetail({
    targetId: id,
    target: chain.target,
    tier: chain.tier,
    attestations: chain.attestations,
    scan,
    bond: chain.bond?.amount ?? 0n,
    src,
  })
  const parsed = TargetDetail.safeParse(built)
  const detail = parsed.success ? parsed.data : null
  const blocksBehind =
    scan?.source.kind === 'contract' && chain.head > BigInt(scan.source.blockNumber)
      ? Number(chain.head - BigInt(scan.source.blockNumber))
      : null
  const unbondingAt = chain.bond && chain.bond.withdrawalAvailableAt > 0 ? chain.bond.withdrawalAvailableAt : null
  return {
    targetId: id,
    detail,
    attestations: rows,
    scan,
    src,
    blocksBehind,
    unbondingAt,
    versionChanged,
    failed: false,
  }
}
