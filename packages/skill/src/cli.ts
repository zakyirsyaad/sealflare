import { readFile } from 'node:fs/promises'
import { keccak256, type Address, type Hex } from 'viem'
import type { Guard } from '@sealflare/guard'
import { AddressSchema, VerdictSchema } from '@sealflare/shared/schemas'
import {
  FLAG_NAMES,
  bundleIdentity,
  isValidFlags,
  targetIdOfContract,
  targetIdOfSkill,
  type BundleEntry,
  type FlagName,
  type Verdict,
} from '@sealflare/shared/rules'
import { parseArgs, usage, type Arguments, type CommandSpec } from './args'
import { readBundle } from './bundle'
import { guardFor, publicClient } from './client'
import { rpcUrl } from './env'
import { escapeText, neutralize } from './output'
import { resolveInputPath } from './paths'
import { maskOfFlags, prepareAttestationReport, validateShortProof, type AttestationTarget } from './prepareAttestation'
import { scanContractReport } from './scanContract'
import { scanSkillReport } from './scanSkill'

export type RunResult = { code: number; output: string }

/** What a test or an embedding program can replace. Without it the guard reads the chain over RPC. */
export type RunDeps = { guard?: Guard }

const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

const REGISTRY_OPTIONS = ['core', 'rpc', 'chain-id'] as const
const SCAN_SPEC: CommandSpec = { options: REGISTRY_OPTIONS, maxPositionals: 1 }
const PREPARE_SPEC: CommandSpec = {
  options: [...REGISTRY_OPTIONS, 'verdict', 'flags', 'proof', 'evidence-file', 'evidence', 'skill'],
  maxPositionals: 1,
}

export const SCAN_CONTRACT_USAGE = usage([
  'scan-contract <address> --core <core address> [--rpc <url>] [--chain-id 56|97]',
  '',
  'Reads the registry and prints the tier, the community signal and the flags of a contract.',
])

export const SCAN_SKILL_USAGE = usage([
  'scan-skill <folder> --core <core address> [--rpc <url>] [--chain-id 56|97]',
  '',
  'Runs the Layer 1 checks on a local skill folder and prints the status of its bundle.',
  'A relative folder is read from the folder you typed the command in.',
])

export const PREPARE_ATTESTATION_USAGE = usage([
  'prepare-attestation <address> --verdict <SAFE|CAUTION|DANGER> --core <core address>',
  '  [--flags <NAME,NAME>] [--proof "FLAG @ location: excerpt"] [--evidence-file <path> --evidence <uri>]',
  '  [--rpc <url>] [--chain-id 56|97]',
  'prepare-attestation --skill <folder> --verdict <SAFE|CAUTION|DANGER> --core <core address> ...',
  '',
  'Prints the parameters of attest() and a summary. It signs nothing and sends nothing.',
  'The proof has one line per flag of the attestation, at most 512 bytes in all.',
])

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every finished output passes through here, so no text of a bundle or of an error can write to the terminal. */
function finish(code: number, output: string): RunResult {
  return { code, output: neutralize(output) }
}

function failure(text: string, help: string): RunResult {
  return finish(1, `${escapeText(text)}\n\nUsage:\n${help}`)
}

/** The chain id of the script, 56 for the mainnet of BNB Chain. */
function chainIdOf(args: Arguments): number {
  const raw = args.values['chain-id']
  if (raw === undefined) return 56
  const value = Number(raw)
  if (value !== 56 && value !== 97) throw new Error('The chain id must be 56 or 97.')
  return value
}

function coreOf(args: Arguments): Address {
  const raw = args.values.core
  if (raw === undefined) throw new Error('The option --core is required.')
  const parsed = AddressSchema.safeParse(raw)
  if (!parsed.success) throw new Error('The core address is not a valid address.')
  return parsed.data
}

/**
 * The reader of the registry. It only reads; it never signs and never sends anything.
 *
 * A missing core address, a bad chain id and a missing RPC endpoint throw here, before any read, so
 * they fail the command with its usage and never turn into an unknown tier.
 */
function guardOf(args: Arguments, deps: RunDeps): Guard {
  if (deps.guard) return deps.guard
  const core = coreOf(args)
  const chainId = chainIdOf(args)
  const client = publicClient(rpcUrl(args.values.rpc), chainId)
  return guardFor(client, core)
}

export async function runScanContract(argv: readonly string[], deps: RunDeps = {}): Promise<RunResult> {
  const parsed = parseArgs(argv, SCAN_SPEC)
  if (!parsed.ok) return failure(parsed.message, SCAN_CONTRACT_USAGE)
  const address = parsed.args.positionals[0]
  if (!address) return failure('Give the address of the contract.', SCAN_CONTRACT_USAGE)
  const validated = AddressSchema.safeParse(address)
  if (!validated.success) return failure('The address of the contract is not a valid address.', SCAN_CONTRACT_USAGE)
  let guard: Guard
  try {
    guard = guardOf(parsed.args, deps)
  } catch (error) {
    return failure(message(error), SCAN_CONTRACT_USAGE)
  }
  try {
    return finish(0, await scanContractReport({ address: validated.data, guard }))
  } catch (error) {
    return finish(1, `The check could not be completed: ${escapeText(message(error))}`)
  }
}

export async function runScanSkill(argv: readonly string[], deps: RunDeps = {}): Promise<RunResult> {
  const parsed = parseArgs(argv, SCAN_SPEC)
  if (!parsed.ok) return failure(parsed.message, SCAN_SKILL_USAGE)
  const given = parsed.args.positionals[0]
  if (!given) return failure('Give the folder of the skill bundle.', SCAN_SKILL_USAGE)
  let guard: Guard
  try {
    guard = guardOf(parsed.args, deps)
  } catch (error) {
    return failure(message(error), SCAN_SKILL_USAGE)
  }
  const folder = resolveInputPath(given)
  try {
    return finish(0, await scanSkillReport({ folder, guard }))
  } catch (error) {
    return finish(1, `The check could not be completed: ${escapeText(message(error))}`)
  }
}

function flagsOf(args: Arguments): { flags: number; names: FlagName[] } {
  const raw = args.values.flags
  if (raw === undefined) return { flags: 0, names: [] }
  const names = raw.split(',').map(name => name.trim().toUpperCase()).filter(name => name.length > 0)
  const unknown = names.filter(name => !(FLAG_NAMES as readonly string[]).includes(name))
  if (unknown.length > 0) throw new Error(`Unknown flag: ${unknown.join(', ')}.`)
  return { flags: maskOfFlags(names as FlagName[]), names: names as FlagName[] }
}

async function evidenceOf(args: Arguments): Promise<{ hash: Hex; uri: string }> {
  const file = args.values['evidence-file']
  const uri = args.values.evidence
  if (file === undefined && uri === undefined) return { hash: ZERO_HASH, uri: '' }
  if (file === undefined || uri === undefined) {
    throw new Error('Give both --evidence-file and --evidence, so the hash matches the bytes that are stored.')
  }
  const bytes = new Uint8Array(await readFile(resolveInputPath(file)))
  return { hash: keccak256(bytes), uri }
}

/** The bytes32 the contract takes: the address as bytes32, or the canonical bundle hash. */
function attestationTarget(args: Arguments, entries?: readonly BundleEntry[]): AttestationTarget {
  const folder = args.values.skill
  const address = args.positionals[0]
  if (folder !== undefined && address !== undefined) {
    throw new Error('Give either the address of a contract or --skill, not both.')
  }
  if (folder !== undefined && entries) {
    const identity = bundleIdentity(entries)
    return {
      type: 'AI_SKILL_BUNDLE',
      target: identity.canonicalBundleHash,
      targetId: targetIdOfSkill(identity.canonicalBundleHash),
      label: resolveInputPath(folder),
      address: null,
    }
  }
  if (!address) throw new Error('Give the address of the contract, or the folder of a skill bundle.')
  const parsed = AddressSchema.safeParse(address)
  if (!parsed.success) throw new Error('The address of the contract is not a valid address.')
  return {
    type: 'SMART_CONTRACT',
    target: `0x${'0'.repeat(24)}${parsed.data.slice(2)}` as Hex,
    targetId: targetIdOfContract(parsed.data),
    label: parsed.data,
    address: parsed.data,
  }
}

/**
 * What the registry says today. Only a failed read of the registry leaves the summary unknown.
 * Input errors never reach this function: the guard is built, and the input is checked, before.
 */
async function summaryOf(guard: Guard, target: AttestationTarget, entries?: readonly BundleEntry[]) {
  try {
    const signal = await guard.signal(target.targetId)
    const tier = target.type === 'SMART_CONTRACT' && target.address
      ? (await guard.checkContract(target.address)).tier
      : (await guard.checkSkill(entries ?? [])).tier
    return { tier, signal }
  } catch {
    return undefined
  }
}

export async function runPrepareAttestation(argv: readonly string[], deps: RunDeps = {}): Promise<RunResult> {
  const parsed = parseArgs(argv, PREPARE_SPEC)
  if (!parsed.ok) return failure(parsed.message, PREPARE_ATTESTATION_USAGE)
  const args = parsed.args
  const verdictRaw = args.values.verdict
  if (verdictRaw === undefined) return failure('The option --verdict is required.', PREPARE_ATTESTATION_USAGE)
  const verdict = VerdictSchema.safeParse(verdictRaw.toUpperCase())
  if (!verdict.success) return failure('The verdict must be SAFE, CAUTION or DANGER.', PREPARE_ATTESTATION_USAGE)
  let prepared: { target: AttestationTarget; flags: number; shortProof: string; evidence: { hash: Hex; uri: string }; entries?: BundleEntry[]; guard: Guard }
  try {
    const { flags, names } = flagsOf(args)
    const shortProof = args.values.proof ?? ''
    validateShortProof(shortProof, flags, verdict.data as Verdict)
    const evidence = await evidenceOf(args)
    const folder = args.values.skill
    // The bundle of a folder is the tracked files of a git work tree, so the target id is the one
    // the registry knows.
    const entries = folder === undefined ? undefined : (await readBundle(resolveInputPath(folder))).hashed
    const target = attestationTarget(args, entries)
    if (!isValidFlags(target.type, verdict.data, flags)) {
      throw new Error(`The flags ${names.join(', ') || 'none'} do not fit the verdict ${verdict.data}.`)
    }
    prepared = { target, flags, shortProof, evidence, guard: guardOf(args, deps), ...(entries ? { entries } : {}) }
  } catch (error) {
    return failure(`The parameters could not be prepared: ${message(error)}`, PREPARE_ATTESTATION_USAGE)
  }
  const summary = await summaryOf(prepared.guard, prepared.target, prepared.entries)
  try {
    const output = prepareAttestationReport({
      target: prepared.target,
      verdict: verdict.data as Verdict,
      flags: prepared.flags,
      shortProof: prepared.shortProof,
      evidenceHash: prepared.evidence.hash,
      evidenceURI: prepared.evidence.uri,
      ...(summary ? { summary } : {}),
    })
    return finish(0, output)
  } catch (error) {
    return failure(`The parameters could not be prepared: ${message(error)}`, PREPARE_ATTESTATION_USAGE)
  }
}
