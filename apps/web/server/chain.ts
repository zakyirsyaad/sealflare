import 'server-only'
import { createPublicClient, fallback, hexToString, http, type Address, type Hex } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { bsc, bscTestnet, foundry } from 'viem/chains'
import { z } from 'zod'
import { coreAbi, vaultAbi } from '@sealflare/shared/abi'
import type { TrustTier } from '@sealflare/shared/rules'
import { TARGET_TYPES, TRUST_TIERS, VERDICTS } from '@sealflare/shared/rules'
import { addresses } from '../lib/chain/addresses'
import { expectedChainId } from '../lib/chain/config'
import { bindMethodOf, publisherRoleOf, type BindMethod, type Binding, type PublisherRole } from '../lib/publish/binding'
import { collectLogs, firstBlockAtOrAfter } from './logRange'

/** The registry reads the chain. It never writes: every write comes from a wallet. */
export type CoreTarget = {
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  target: Hex
  pinnedCodehash: Hex
  hasDelegatecall: boolean
  publisher: Address
  publisherRole: 'NONE' | 'THIRD_PARTY_SPONSOR' | 'VERIFIED_PUBLISHER'
  safeWeight: number
  cautionWeight: number
  dangerWeight: number
  activeFlags: number
  attestationCount: number
  safeCount: number
  confirmedDanger: boolean
  activeChallengeId: bigint
  createdAt: number
}

export type CoreAttestation = {
  guardian: Address
  verdict: 'SAFE' | 'CAUTION' | 'DANGER'
  flags: number
  weight: number
  safeOrdinal: number
  timestamp: number
  settled: boolean
  penalized: boolean
  castDuringDispute: boolean
}

/** The parts of an attestation that only the event log carries. */
export type EvidenceRow = { index: number; shortProof: string; evidenceURI: string; txHash: Hex }

export type BondState = { amount: bigint; withdrawalAvailableAt: number; lockedByChallengeId: bigint }

/** Everything the target page needs from the chain. */
export interface ChainReader {
  /** Null when the registry has never seen this target. */
  target(targetId: Hex): Promise<CoreTarget | null>
  /** The tier always comes from Core, never from a cached row. */
  tier(targetId: Hex): Promise<TrustTier>
  attestations(targetId: Hex, count: number): Promise<CoreAttestation[]>
  /** The evidence of the event log, read from the block the target was created in. Rejects when the log cannot be read in full. */
  evidence(targetId: Hex, createdAt: number, count: number): Promise<EvidenceRow[]>
  /** The evidence of the event log above a block, for the votes that are not final yet. */
  evidenceFrom(targetId: Hex, fromBlock: bigint): Promise<EvidenceRow[]>
  bond(targetId: Hex, publisher: Address): Promise<BondState | null>
  /** How the target was bound, read from the event log. Null when the log does not say. */
  binding(targetId: Hex, createdAt: number): Promise<Binding | null>
}

/** How many attestation reads run at the same time. */
const READ_BATCH = 10

const RpcUrls = z
  .string()
  .optional()
  .transform(value =>
    (value ?? '')
      .split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0),
  )

function rpcUrls(): string[] {
  return RpcUrls.parse(process.env.RPC_URLS)
}

function pick<T>(list: readonly T[], index: number | bigint, what: string): T {
  const position = Number(index)
  const found = Number.isInteger(position) && position >= 0 ? list[position] : undefined
  if (found === undefined) throw new RangeError(`Core returned an unknown ${what}.`)
  return found
}

/** The enums of Core come from the shared lists, and an index outside them throws instead of becoming undefined. */
export const verdictOf = (index: number | bigint) => pick(VERDICTS, index, 'verdict')
export const targetTypeOf = (index: number | bigint) => pick(TARGET_TYPES, index, 'target type')
export { publisherRoleOf }

function chainFor(chainId: number) {
  if (chainId === bsc.id) return bsc
  if (chainId === bscTestnet.id) return bscTestnet
  return foundry
}

/**
 * The client is built once per chain and set of RPC urls. A page view reads the target, its tier
 * and every attestation, and a new client for each of those reads would open a new connection
 * for every call.
 */
let cachedClient: { key: string; client: ReturnType<typeof createPublicClient> } | null = null

export function getRpcClient(): ReturnType<typeof createPublicClient> {
  const chain = chainFor(expectedChainId)
  const urls = rpcUrls()
  const key = `${chain.id}|${urls.join(',')}`
  if (cachedClient !== null && cachedClient.key === key) return cachedClient.client
  const transport = urls.length === 0 ? http() : fallback(urls.map(url => http(url)))
  const client = createPublicClient({ chain, transport })
  cachedClient = { key, client }
  return client
}

/** The read of a test starts with no client, as a fresh process would. */
export function clearRpcClient(): void {
  cachedClient = null
}

function coreAddress(): Address {
  return addresses(expectedChainId).core
}

function vaultAddress(): Address | null {
  return addresses(expectedChainId).vault
}

type AbiEventItem = Extract<(typeof coreAbi)[number], { type: 'event' }>

/** The event of the frozen Core ABI, with its argument types intact. */
function eventItem<E extends AbiEventItem>(name: E['name']): E {
  const item = coreAbi.find(entry => entry.type === 'event' && entry.name === name)
  if (!item) throw new RangeError(`The Core ABI has no ${name} event.`)
  return item as E
}

type AttestedEvent = Extract<AbiEventItem, { name: 'Attested' }>

function targetExists(target: CoreTarget): boolean {
  return target.createdAt > 0
}

async function readTarget(targetId: Hex): Promise<CoreTarget | null> {
  const raw = await getRpcClient().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getTarget',
    args: [targetId],
  })
  const target = {
    targetType: targetTypeOf(raw.targetType),
    target: raw.target,
    pinnedCodehash: raw.pinnedCodehash,
    hasDelegatecall: raw.hasDelegatecall,
    publisher: raw.publisher,
    publisherRole: publisherRoleOf(raw.publisherRole),
    safeWeight: Number(raw.safeWeight),
    cautionWeight: Number(raw.cautionWeight),
    dangerWeight: Number(raw.dangerWeight),
    activeFlags: Number(raw.activeFlags),
    attestationCount: Number(raw.attestationCount),
    safeCount: Number(raw.safeCount),
    confirmedDanger: raw.confirmedDanger,
    activeChallengeId: raw.activeChallengeId,
    createdAt: Number(raw.createdAt),
  }
  return targetExists(target) ? target : null
}

async function readAttestation(targetId: Hex, index: number): Promise<CoreAttestation> {
  const raw = await getRpcClient().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getAttestation',
    args: [targetId, index],
  })
  return {
    guardian: raw.guardian,
    verdict: verdictOf(raw.verdict),
    flags: Number(raw.flags),
    weight: Number(raw.weight),
    safeOrdinal: Number(raw.safeOrdinal),
    timestamp: Number(raw.timestamp),
    settled: raw.settled,
    penalized: raw.penalized,
    castDuringDispute: raw.castDuringDispute,
  }
}

async function readAttestations(targetId: Hex, count: number): Promise<CoreAttestation[]> {
  const rows: CoreAttestation[] = []
  for (let start = 0; start < count; start += READ_BATCH) {
    const indexes = Array.from({ length: Math.min(READ_BATCH, count - start) }, (_, offset) => start + offset)
    rows.push(...(await Promise.all(indexes.map(index => readAttestation(targetId, index)))))
  }
  return rows
}

/** The short proof is bytes on chain. It is shown as the text it is. */
function proofText(proof: string | undefined): string {
  if (proof === undefined) return ''
  try {
    return hexToString(proof as Hex)
  } catch {
    return proof
  }
}

/** A target's creation block never changes, so the search for it runs once per process. */
const createdBlocks = new Map<string, bigint>()

async function createdBlock(targetId: Hex, createdAt: number, head: bigint): Promise<bigint> {
  const known = createdBlocks.get(targetId.toLowerCase())
  if (known !== undefined) return known
  const block = await firstBlockAtOrAfter(createdAt, head, async number =>
    Number((await getRpcClient().getBlock({ blockNumber: number })).timestamp),
  )
  createdBlocks.set(targetId.toLowerCase(), block)
  return block
}

/**
 * The logs that were already read, per target, with the block they were read up to. A later view
 * of the same target fetches only the blocks that came after it, so a page view does not read the
 * whole history again.
 */
const evidenceCache = new Map<string, { block: bigint; rows: EvidenceRow[] }>()

/** The read logs of the tests start from an empty cache, as a fresh process would. */
export function clearEvidenceCache(): void {
  evidenceCache.clear()
  bindings.clear()
}

/**
 * How many blocks the read waits before it trusts a log. A block that is this far behind the head
 * is not going to change, so a log that is read from it stays read.
 */
const CONFIRMATIONS = 12n

/**
 * The Attested logs of a target, from the block it was created in to the head, in bounded ranges.
 * Any failed range, or a target too old to read this way, rejects: the caller reports that the
 * evidence is unavailable instead of showing an empty list as if no proof was linked.
 *
 * The cache stops at the confirmed block, not at the head. The blocks above it are read again on
 * the next view, because a log that a node did not return for a block that is not final yet would
 * otherwise never be read again. The rows are kept by their index, so a log that is read twice
 * stays one row.
 */
async function readEvidence(targetId: Hex, createdAt: number, count: number): Promise<EvidenceRow[]> {
  // The head is read without the cache of the client: the confirmed block below depends on it.
  const head = await getBlockNumber(getRpcClient(), { cacheTime: 0 })
  const key = targetId.toLowerCase()
  const cached = evidenceCache.get(key)
  const fromBlock = cached === undefined ? await createdBlock(targetId, createdAt, head) : cached.block + 1n
  // Nothing new since the last read of this target.
  if (fromBlock > head) return checkedRows(key, cached?.rows ?? [], count)
  const event = eventItem<AttestedEvent>('Attested')
  const logs = await collectLogs(
    (from, to) => getRpcClient().getLogs({ address: coreAddress(), event, args: { targetId }, fromBlock: from, toBlock: to }),
    fromBlock,
    head,
  )
  const byIndex = new Map<number, EvidenceRow>()
  for (const row of cached?.rows ?? []) byIndex.set(row.index, row)
  for (const log of logs) {
    byIndex.set(Number(log.args.index), {
      index: Number(log.args.index),
      shortProof: proofText(log.args.shortProof),
      evidenceURI: log.args.evidenceURI ?? '',
      txHash: log.transactionHash,
    })
  }
  const rows = [...byIndex.values()].sort((left, right) => left.index - right.index)
  const confirmed = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n
  evidenceCache.set(key, { block: confirmed, rows })
  return checkedRows(key, rows, count)
}

/**
 * The rows are only shown when they cover every attestation of the target. A hole drops the cache,
 * so the next view reads the history of the target again.
 */
function checkedRows(key: string, rows: readonly EvidenceRow[], count: number): EvidenceRow[] {
  try {
    return completeEvidence(rows, count)
  } catch (error) {
    evidenceCache.delete(key)
    throw error
  }
}

/**
 * The Attested logs of a target above a block, in bounded ranges.
 *
 * The rows are not checked for holes here: the caller joins them with the rows of the internal
 * service, and only the joined set has to cover every attestation of the target.
 */
async function readEvidenceFrom(targetId: Hex, fromBlock: bigint): Promise<EvidenceRow[]> {
  const head = await getBlockNumber(getRpcClient(), { cacheTime: 0 })
  if (fromBlock > head) return []
  const event = eventItem<AttestedEvent>('Attested')
  const logs = await collectLogs(
    (from, to) => getRpcClient().getLogs({ address: coreAddress(), event, args: { targetId }, fromBlock: from, toBlock: to }),
    fromBlock,
    head,
  )
  return logs.map(log => ({
    index: Number(log.args.index),
    shortProof: proofText(log.args.shortProof),
    evidenceURI: log.args.evidenceURI ?? '',
    txHash: log.transactionHash,
  }))
}

/**
 * The rows have to cover every attestation of the target. A log that is missing leaves a hole, and
 * a list with a hole is never shown as the complete list of the evidence.
 */
export function completeEvidence(rows: readonly EvidenceRow[], count: number): EvidenceRow[] {
  const found = new Set(rows.map(row => row.index))
  const missing: number[] = []
  for (let index = 0; index < count; index += 1) if (!found.has(index)) missing.push(index)
  if (missing.length === 0) return [...rows]
  throw new Error(`The event log of the target is not complete: the attestations ${missing.join(', ')} are missing.`)
}

async function readBond(targetId: Hex, publisher: Address): Promise<BondState | null> {
  const vault = vaultAddress()
  if (vault === null) return null
  try {
    const raw = await getRpcClient().readContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'bondOf',
      args: [targetId, publisher],
    })
    return {
      amount: raw.amount,
      withdrawalAvailableAt: Number(raw.withdrawalAvailableAt),
      lockedByChallengeId: raw.lockedByChallengeId,
    }
  } catch {
    return null
  }
}

type PublisherBoundEvent = Extract<AbiEventItem, { name: 'PublisherBound' }>

/**
 * How the target was bound, read from the event log of Core. The last PublisherBound event wins,
 * because a target can be bound only once. A log that cannot be read leaves the method unknown:
 * the page then says so instead of guessing.
 */
/** Core refuses a second bind of a target, so a binding that is confirmed is read once per process. */
const bindings = new Map<string, Binding>()

async function readBinding(targetId: Hex, createdAt: number): Promise<Binding | null> {
  const known = bindings.get(targetId.toLowerCase())
  if (known !== undefined) return known
  try {
    const head = await getBlockNumber(getRpcClient(), { cacheTime: 0 })
    const from = await createdBlock(targetId, createdAt, head)
    if (from > head) return null
    const event = eventItem<PublisherBoundEvent>('PublisherBound')
    const logs = await collectLogs(
      (low, high) =>
        getRpcClient().getLogs({ address: coreAddress(), event, args: { targetId }, fromBlock: low, toBlock: high }),
      from,
      head,
    )
    const last = logs.at(-1)
    if (last === undefined) return null
    const { publisher, role, method } = last.args
    if (publisher === undefined || role === undefined || method === undefined) return null
    const binding = { publisher, role: publisherRoleOf(role), method: bindMethodOf(method) }
    if (last.blockNumber !== null && last.blockNumber <= head - CONFIRMATIONS) {
      bindings.set(targetId.toLowerCase(), binding)
    }
    return binding
  } catch {
    return null
  }
}

/** The reader used by the target page. Every call goes out over a public RPC. */
export function getChainReader(): ChainReader {
  return {
    target: readTarget,
    tier: async targetId => {
      const value = await getRpcClient().readContract({
        address: coreAddress(),
        abi: coreAbi,
        functionName: 'tierOf',
        args: [targetId],
      })
      return pick(TRUST_TIERS, value, 'trust tier')
    },
    attestations: readAttestations,
    evidence: readEvidence,
    evidenceFrom: readEvidenceFrom,
    bond: readBond,
    binding: readBinding,
  }
}
