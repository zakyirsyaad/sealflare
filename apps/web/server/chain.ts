import 'server-only'
import { createPublicClient, fallback, hexToString, http, type Address, type Hex } from 'viem'
import { bsc, bscTestnet, foundry } from 'viem/chains'
import { z } from 'zod'
import { coreAbi, vaultAbi } from '@sealflare/shared/abi'
import type { TrustTier } from '@sealflare/shared/rules'
import { TRUST_TIERS } from '@sealflare/shared/rules'
import { addresses } from '../lib/chain/addresses'
import { expectedChainId } from '../lib/chain/config'

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
  head(): Promise<bigint>
  /** Null when the registry has never seen this target. */
  target(targetId: Hex): Promise<CoreTarget | null>
  /** The tier always comes from Core, never from a cached row. */
  tier(targetId: Hex): Promise<TrustTier>
  attestations(targetId: Hex, count: number): Promise<CoreAttestation[]>
  evidence(targetId: Hex): Promise<EvidenceRow[]>
  bond(targetId: Hex, publisher: Address): Promise<BondState | null>
}

/** How far back the event log is searched for the attestations of a target. */
export const EVIDENCE_WINDOW = 50_000n
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

function chainFor(chainId: number) {
  if (chainId === bsc.id) return bsc
  if (chainId === bscTestnet.id) return bscTestnet
  return foundry
}

function client() {
  const chain = chainFor(expectedChainId)
  const urls = rpcUrls()
  const transport = urls.length === 0 ? http() : fallback(urls.map(url => http(url)))
  return createPublicClient({ chain, transport })
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
type TargetCreatedEvent = Extract<AbiEventItem, { name: 'TargetCreated' }>

function targetExists(target: CoreTarget): boolean {
  return target.createdAt > 0
}

async function readTarget(targetId: Hex): Promise<CoreTarget | null> {
  const raw = await client().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getTarget',
    args: [targetId],
  })
  const target = {
    targetType: Number(raw.targetType) === 1 ? ('AI_SKILL_BUNDLE' as const) : ('SMART_CONTRACT' as const),
    target: raw.target,
    pinnedCodehash: raw.pinnedCodehash,
    hasDelegatecall: raw.hasDelegatecall,
    publisher: raw.publisher,
    publisherRole: ['NONE', 'THIRD_PARTY_SPONSOR', 'VERIFIED_PUBLISHER'][Number(raw.publisherRole)] as CoreTarget['publisherRole'],
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
  const raw = await client().readContract({
    address: coreAddress(),
    abi: coreAbi,
    functionName: 'getAttestation',
    args: [targetId, index],
  })
  return {
    guardian: raw.guardian,
    verdict: ['SAFE', 'CAUTION', 'DANGER'][Number(raw.verdict)] as CoreAttestation['verdict'],
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

/** The block the target was created in, so the log search can start there. */
async function createdBlock(targetId: Hex, head: bigint): Promise<bigint> {
  const earliest = head > EVIDENCE_WINDOW ? head - EVIDENCE_WINDOW : 0n
  try {
    const logs = await client().getLogs({
      address: coreAddress(),
      event: eventItem<TargetCreatedEvent>('TargetCreated'),
      args: { targetId },
      fromBlock: earliest,
      toBlock: head,
    })
    const block = logs[0]?.blockNumber
    return block === undefined ? earliest : block
  } catch {
    return earliest
  }
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

async function readEvidence(targetId: Hex): Promise<EvidenceRow[]> {
  const head = await client().getBlockNumber()
  const fromBlock = await createdBlock(targetId, head)
  try {
    const logs = await client().getLogs({
      address: coreAddress(),
      event: eventItem<AttestedEvent>('Attested'),
      args: { targetId },
      fromBlock,
      toBlock: head,
    })
    return logs.map(log => ({
      index: Number(log.args.index),
      shortProof: proofText(log.args.shortProof),
      evidenceURI: log.args.evidenceURI ?? '',
      txHash: log.transactionHash,
    }))
  } catch {
    // Without the log the votes are still known. The evidence link is then missing, never guessed.
    return []
  }
}

async function readBond(targetId: Hex, publisher: Address): Promise<BondState | null> {
  const vault = vaultAddress()
  if (vault === null) return null
  try {
    const raw = await client().readContract({
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

/** The reader used by the target page. Every call goes out over a public RPC. */
export function getChainReader(): ChainReader {
  return {
    head: () => client().getBlockNumber(),
    target: readTarget,
    tier: async targetId => {
      const value = await client().readContract({
        address: coreAddress(),
        abi: coreAbi,
        functionName: 'tierOf',
        args: [targetId],
      })
      const tier = TRUST_TIERS[Number(value)]
      if (tier === undefined) throw new RangeError('Core returned an unknown trust tier.')
      return tier
    },
    attestations: readAttestations,
    evidence: readEvidence,
    bond: readBond,
  }
}
