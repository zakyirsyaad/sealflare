import 'server-only'
import type { Hex } from 'viem'
import { Bytes32Schema, decodeSrc, encodeSrc, TargetDetail, type AttestationRow, type ScanReport, type SignalGroup } from '@sealflare/shared/schemas'
import { ZERO_ADDRESS, targetIdOfContract, type TrustTier } from '@sealflare/shared/rules'
import { getChainReader, completeEvidence, type ChainReader, type CoreAttestation, type CoreTarget, type EvidenceRow } from './chain'
import { readIndexedEvidence } from './indexedEvidence'
import { getScan, getScanForSource, putScan, putScanForSource } from './scanStore'
import { getScanEnvironment } from './scanner'
import { contractWord } from '../lib/targetWord'
import type { Binding } from '../lib/publish/binding'
import type { PublisherBond } from '../lib/publish/bond'

const ZERO_HASH = `0x${'0'.repeat(64)}` as const

/** The bytes32 of a contract target carries the address in its last twenty bytes. */
export function addressOf(target: CoreTarget): Hex {
  return `0x${target.target.slice(-40)}` as Hex
}

/**
 * The word `Core.attest` takes.
 *
 * A contract is named by its address, a skill by the canonical hash of its bundle. The id of a
 * target is the hash of that word, so the id is never the word itself.
 */
export function targetWordOf(target: CoreTarget | null, scan: ScanReport | null, isContract: boolean): string | null {
  if (!isContract) {
    if (target !== null) return target.target
    return scan?.source.kind === 'skill' ? scan.source.canonicalBundleHash : null
  }
  const address = target !== null ? addressOf(target) : (scan?.source.kind === 'contract' ? scan.source.address : null)
  return address === null ? null : contractWord(address)
}

/** Whether the bundle that was scanned is another bundle than the one the registry sealed. */
export function bundleChanged(target: CoreTarget | null, scan: ScanReport | null): boolean {
  if (target === null || target.targetType !== 'AI_SKILL_BUNDLE') return false
  if (scan === null || scan.targetType !== 'AI_SKILL_BUNDLE' || scan.source.kind !== 'skill') return false
  return target.target.toLowerCase() !== scan.source.canonicalBundleHash.toLowerCase()
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
    : // The source of a skill is only the one a scan of this very target found. A link that names
      // another bundle is never shown as the source of the rated skill.
      (scan ? encodeSrc(scan.source) : null)
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

type OnChainType = CoreTarget['targetType'] | null

/**
 * Whether a `?src=` can describe this target at all. A contract id is the hash of its address, so
 * another address is never this target. A skill id is the hash of its bundle, which is only known
 * after scanning, so any skill source may be a version of it. The kind has to match the registry.
 */
function sourceFitsTarget(reference: NonNullable<ReturnType<typeof decodeSrc>>, id: Hex, type: OnChainType): boolean {
  if (reference.kind === 'skill') return type !== 'SMART_CONTRACT'
  return type !== 'AI_SKILL_BUNDLE' && targetIdOfContract(reference.address).toLowerCase() === id.toLowerCase()
}

/** The scan of this target, either the cached one or a fresh one for the given source. */
export async function loadScan(targetId: Hex, src: string | null, type: OnChainType = null): Promise<ScanReport | null> {
  const cached = getScan(targetId)
  if (cached) return cached
  if (src === null) return null
  const reference = decodeSrc(src)
  if (reference === null || !sourceFitsTarget(reference, targetId, type)) return null
  const known = getScanForSource(src)
  if (known) return known
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
    putScanForSource(src, report)
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
  /** Always null until the indexer reports its finalized block. The scan's age is not the lag of the data. */
  blocksBehind: number | null
  unbondingAt: number | null
  /** The link names another bundle than the one the registry rated. */
  differentBundle: boolean
  /** The event log could not be read in full, so the evidence and transaction links are unknown. */
  evidenceFailed: boolean
  failed: boolean
  /** The word `Core.attest` takes for this target. Null when the target is not known yet. */
  targetWord: string | null
  /** The scanned bundle is another bundle than the one the registry sealed. */
  bundleChanged: boolean
  /** How the target was bound, read from the event log. Null when the log does not say. */
  binding: Binding | null
  /** The bond of the publisher, as the vault holds it. */
  publisherBond: PublisherBond | null
}

/**
 * The evidence of a target: the proof and the transaction of every attestation.
 *
 * The votes that are final come from the internal service, so the cost of a page does not depend
 * on the age of the target. The votes that are not final yet are read from the chain. Without the
 * internal service, or when the tail cannot be read, the whole log is read from the chain.
 */
async function readEvidence(reader: ChainReader, targetId: Hex, createdAt: number, count: number): Promise<EvidenceRow[]> {
  const indexed = await readIndexedEvidence(targetId)
  if (indexed === null) return reader.evidence(targetId, createdAt, count)
  try {
    const tail = await reader.evidenceFrom(targetId, indexed.finalizedBlock + 1n)
    return completeEvidence([...indexed.rows, ...tail], count)
  } catch {
    // The tail could not be read, or the rows do not cover every vote, so the whole log of the
    // target is read from the chain instead.
    return reader.evidence(targetId, createdAt, count)
  }
}

async function readChain(reader: ChainReader, targetId: Hex) {
  // One block for the target, its votes, its tier and the bond of its publisher, so they come from
  // the same moment. The event log (the evidence and the binding) is read up to the head: it holds
  // links and the way the target was bound, not a number that can disagree with the votes.
  const block = await reader.tierBlockNumber()
  const target = await reader.target(targetId, block)
  const tier = target ? await reader.tier(targetId, block) : 'UNRATED'
  const attestations = target ? await reader.attestations(targetId, target.attestationCount, block) : []
  let evidence: EvidenceRow[] = []
  let evidenceFailed = false
  // A target without attestations has no event to read. The log is never walked for nothing.
  if (target && target.attestationCount > 0) {
    try {
      evidence = await readEvidence(reader, targetId, target.createdAt, target.attestationCount)
    } catch {
      // The votes and the tier come from contract reads and stay. Only the links are unknown.
      evidenceFailed = true
    }
  }
  const bond =
    target && target.publisher !== ZERO_ADDRESS ? await reader.bond(targetId, target.publisher, block) : null
  // A target with no publisher has no PublisherBound event, so the log is not walked for it.
  const binding =
    target === null || target.publisher === ZERO_ADDRESS
      ? null
      : await reader.binding(targetId, target.createdAt, { publisher: target.publisher, role: target.publisherRole })
  return { target, tier, attestations, evidence, evidenceFailed, bond, binding }
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
    differentBundle: false,
    evidenceFailed: false,
    failed: false,
    targetWord: null,
    bundleChanged: false,
    binding: null,
    publisherBond: null,
  }
  if (!parsedId.success) return { ...empty, failed: true }
  const id = parsedId.data
  let chain: Awaited<ReturnType<typeof readChain>>
  try {
    chain = await readChain(getChainReader(), id)
  } catch {
    return { ...empty, failed: true }
  }
  const candidate = await loadScan(id, src, chain.target?.targetType ?? null)
  // Only the scan of this very target is shown. Another target's findings never appear under this tier.
  const scan = candidate !== null && candidate.targetId.toLowerCase() === id.toLowerCase() ? candidate : null
  const isSkillTarget = chain.target?.targetType === 'AI_SKILL_BUNDLE'
  const otherSkill =
    candidate !== null && scan === null && isSkillTarget && candidate.targetType === 'AI_SKILL_BUNDLE'
  // The publisher of a bundle is written by the bundle itself, so it is never a proof that a link
  // names a new version of the rated skill: a bundle that copies the address of a verified
  // publisher would otherwise pass for one, and that is exactly the skill worth impersonating.
  // Without a verified publisher signature every link that names another bundle is a different
  // bundle, and the page never offers it as a version of the rated one.
  const differentBundle = otherSkill
  const rows = attestationRows(chain.attestations, chain.evidence)
  const built = buildDetail({
    targetId: id,
    target: chain.target,
    tier: chain.tier,
    attestations: chain.attestations,
    scan,
    bond: chain.bond?.amount ?? 0n,
  })
  const parsed = TargetDetail.safeParse(built)
  const detail = parsed.success ? parsed.data : null
  const unbondingAt = chain.bond && chain.bond.withdrawalAvailableAt > 0 ? chain.bond.withdrawalAvailableAt : null
  const isContractTarget = (chain.target?.targetType ?? scan?.targetType ?? 'SMART_CONTRACT') === 'SMART_CONTRACT'
  const publisherBond: PublisherBond | null =
    chain.bond === null
      ? null
      : {
          amount: chain.bond.amount.toString(),
          withdrawalAvailableAt: unbondingAt,
          lockedByChallengeId:
            chain.bond.lockedByChallengeId > 0n ? chain.bond.lockedByChallengeId.toString() : null,
        }
  return {
    targetId: id,
    detail,
    attestations: rows,
    scan,
    src,
    blocksBehind: null,
    unbondingAt,
    differentBundle,
    evidenceFailed: chain.evidenceFailed,
    failed: false,
    targetWord: targetWordOf(chain.target, scan, isContractTarget),
    bundleChanged: bundleChanged(chain.target, candidate),
    binding: chain.binding,
    publisherBond,
  }
}
