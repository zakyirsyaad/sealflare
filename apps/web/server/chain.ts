import 'server-only'
import { createPublicClient, fallback, hexToString, http, type Address, type Hex, type PublicClient } from 'viem'
import { bsc, bscTestnet, foundry } from 'viem/chains'
import { z } from 'zod'
import { coreAbi, vaultAbi } from '@sealflare/shared/abi'
import type { TrustTier } from '@sealflare/shared/rules'
import { TARGET_TYPES, TRUST_TIERS, VERDICTS } from '@sealflare/shared/rules'
import { addresses } from '../lib/chain/addresses'
import { expectedChainId } from '../lib/chain/config'
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

export type BondState = { amount: bigint; withdrawalAvailableAt: number }

/** Everything the target page needs from the chain. */
export interface ChainReader {
  /** Null when the registry has never seen this target. Read at the block when one is given. */
  target(targetId: Hex, blockNumber?: bigint): Promise<CoreTarget | null>
  /**
   * The tier always comes from Core, never from a cached row. A page passes the block it reads
   * everything at, so it shows one moment; without one the tier is read a few blocks below the head.
   */
  tier(targetId: Hex, blockNumber?: bigint): Promise<TrustTier>
  /** The tier at a fixed block, so every tier of one answer comes from the same moment. */
  tierAt(targetId: Hex, blockNumber: bigint): Promise<TrustTier>
  /** The block the tiers are read at, a few blocks below the head and shared by one answer. */
  tierBlockNumber(): Promise<bigint>
  /** Whether the address holds an Agent ID, which every signed request needs. */
  isAgentIdHolder(address: Address): Promise<boolean>
  attestations(targetId: Hex, count: number, blockNumber?: bigint): Promise<CoreAttestation[]>
  /** The evidence of the event log, read from the block the target was created in. Rejects when the log cannot be read in full. */
  evidence(targetId: Hex, createdAt: number, count: number): Promise<EvidenceRow[]>
  /** The evidence of the event log above a block, for the votes that are not final yet. */
  evidenceFrom(targetId: Hex, fromBlock: bigint): Promise<EvidenceRow[]>
  bond(targetId: Hex, publisher: Address): Promise<BondState | null>
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

const PUBLISHER_ROLES = ['NONE', 'THIRD_PARTY_SPONSOR', 'VERIFIED_PUBLISHER'] as const

function pick<T>(list: readonly T[], index: number | bigint, what: string): T {
  const position = Number(index)
  const found = Number.isInteger(position) && position >= 0 ? list[position] : undefined
  if (found === undefined) throw new RangeError(`Core returned an unknown ${what}.`)
  return found
}

/** The enums of Core come from the shared lists, and an index outside them throws instead of becoming undefined. */
export const verdictOf = (index: number | bigint) => pick(VERDICTS, index, 'verdict')
export const targetTypeOf = (index: number | bigint) => pick(TARGET_TYPES, index, 'target type')
export const publisherRoleOf = (index: number | bigint) => pick(PUBLISHER_ROLES, index, 'publisher role')

function chainFor(chainId: number) {
  if (chainId === bsc.id) return bsc
  if (chainId === bscTestnet.id) return bscTestnet
  return foundry
}

/**
 * How many calls the transport puts into one request, and how long it waits for the others.
 *
 * Some providers refuse a large batch: the keyless endpoint that viem uses for BSC takes 25 calls
 * and a free plan of another provider takes 3. viem copies the error of a refused batch to every
 * call, and the fallback sends the same batch to the next url, so one such provider in the list
 * would fail every read. The batch stays small, and the many reads of a list go out as Multicall3
 * calls instead (see `getRpcClient`).
 */
const BATCHING = { batch: { batchSize: 10, wait: 10 } } as const

/**
 * The client of the chain.
 *
 * The client is built once and kept, because the batching of the transport only works inside one
 * client. A client of its own for every read would send every read in a request of its own. The
 * reads of one block that come at the same time are grouped into Multicall3 calls, so the tiers of
 * a list are a few `eth_call`s and not one call each. viem reads the address of Multicall3 from the
 * chain, and a chain without one, such as the local Anvil, is read with plain `eth_call`s.
 */
let cached: { key: string; client: PublicClient } | null = null

export function getRpcClient(): PublicClient {
  const chain = chainFor(expectedChainId)
  const urls = rpcUrls()
  const key = `${chain.id}|${urls.join(',')}`
  if (cached !== null && cached.key === key) return cached.client
  const transport = urls.length === 0 ? http(undefined, BATCHING) : fallback(urls.map(url => http(url, BATCHING)))
  // The client is kept, so its cache is kept too. A block number that is cached would be read as
  // the head of the chain for the rest of the life of the process.
  const built = createPublicClient({ chain, transport, cacheTime: 0, batch: { multicall: true } })
  cached = { key, client: built }
  return built
}

/** The read of a test starts with no client, as a fresh process would. */
export function clearRpcClient(): void {
  cached = null
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

async function readTarget(targetId: Hex, blockNumber?: bigint): Promise<CoreTarget | null> {
  const raw = await getRpcClient().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getTarget',
    args: [targetId],
    ...(blockNumber === undefined ? {} : { blockNumber }),
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

async function readAttestation(targetId: Hex, index: number, blockNumber?: bigint): Promise<CoreAttestation> {
  const raw = await getRpcClient().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getAttestation',
    args: [targetId, index],
    ...(blockNumber === undefined ? {} : { blockNumber }),
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

async function readAttestations(targetId: Hex, count: number, blockNumber?: bigint): Promise<CoreAttestation[]> {
  const rows: CoreAttestation[] = []
  for (let start = 0; start < count; start += READ_BATCH) {
    const indexes = Array.from({ length: Math.min(READ_BATCH, count - start) }, (_, offset) => start + offset)
    rows.push(...(await Promise.all(indexes.map(index => readAttestation(targetId, index, blockNumber)))))
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
  // The client keeps no block number (cacheTime 0): the confirmed block below depends on the head.
  const head = await getRpcClient().getBlockNumber()
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
  const head = await getRpcClient().getBlockNumber()
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
    return { amount: raw.amount, withdrawalAvailableAt: Number(raw.withdrawalAvailableAt) }
  } catch {
    return null
  }
}

/**
 * The tier of a target, read from Core. The block is optional: without it the tier is read a few
 * blocks below the head, and with it the tier is read at the moment the answer names.
 */
async function readTier(targetId: Hex, blockNumber?: bigint): Promise<TrustTier> {
  const value = await getRpcClient().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'tierOf',
    args: [targetId],
    ...(blockNumber === undefined ? {} : { blockNumber }),
  })
  return pick(TRUST_TIERS, value, 'trust tier')
}

/**
 * How many blocks below the head the tiers are read.
 *
 * The head of one node is not the head of the next one. A node that is a few blocks behind
 * cannot answer for a block it does not have, and a tier of the exact head is not worth an answer
 * that fails. Three blocks are enough for a node that lags a little.
 */
const TIER_MARGIN = 3n

/**
 * The block the tiers are read at.
 *
 * Every tier of one answer comes from this block, so the tiers of a list cannot disagree about
 * how old they are.
 */
async function tierBlockNumber(): Promise<bigint> {
  const head = await getRpcClient().getBlockNumber()
  return head > TIER_MARGIN ? head - TIER_MARGIN : 0n
}

/** The reader used by the target page. Every call goes out over a public RPC. */
export function getChainReader(): ChainReader {
  return {
    target: readTarget,
    tier: async (targetId, blockNumber) => readTier(targetId, blockNumber ?? (await tierBlockNumber())),
    tierAt: (targetId, blockNumber) => readTier(targetId, blockNumber),
    tierBlockNumber,
    isAgentIdHolder: async address => {
      const value = await getRpcClient().readContract({
        address: coreAddress(),
        abi: coreAbi,
        functionName: 'isAgentIdHolder',
        args: [address],
      })
      return value
    },
    attestations: readAttestations,
    evidence: readEvidence,
    evidenceFrom: readEvidenceFrom,
    bond: readBond,
  }
}
