import { readFile } from 'node:fs/promises'
import { keccak256, type Address, type Hex } from 'viem'
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
import { parseArgs, usage, type Arguments } from './args'
import { readFolder } from './bundle'
import { guardFor, publicClient } from './client'
import { rpcUrl } from './env'
import { maskOfFlags, prepareAttestationReport, type AttestationTarget } from './prepareAttestation'
import { scanContractReport } from './scanContract'
import { scanSkillReport } from './scanSkill'

export type RunResult = { code: number; output: string }

const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

export const SCAN_CONTRACT_USAGE = usage([
  'scan-contract <address> --core <core address> [--rpc <url>] [--chain-id 56|97] [--vault <vault address>]',
  '',
  'Reads the registry and prints the tier, the community signal and the flags of a contract.',
])

export const SCAN_SKILL_USAGE = usage([
  'scan-skill <folder> --core <core address> [--rpc <url>] [--chain-id 56|97] [--vault <vault address>]',
  '',
  'Runs the Layer 1 checks on a local skill folder and prints the status of its bundle.',
])

export const PREPARE_ATTESTATION_USAGE = usage([
  'prepare-attestation <address> --verdict <SAFE|CAUTION|DANGER> --core <core address>',
  '  [--flags <NAME,NAME>] [--proof <text>] [--evidence-file <path> --evidence <uri>]',
  '  [--rpc <url>] [--chain-id 56|97]',
  'prepare-attestation --skill <folder> --verdict <SAFE|CAUTION|DANGER> --core <core address> ...',
  '',
  'Prints the parameters of attest() and a summary. It signs nothing and sends nothing.',
])

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(text: string, help: string): RunResult {
  return { code: 1, output: `${text}\n\nUsage:\n${help}` }
}

/** The chain id of the script, 56 for the mainnet of BNB Chain. */
function chainIdOf(args: Arguments): number {
  const raw = args.values['chain-id']
  if (raw === undefined) return 56
  const value = Number(raw)
  if (value !== 56 && value !== 97) throw new Error('The chain id must be 56 or 97.')
  return value
}

function vaultOf(args: Arguments): Address | undefined {
  const raw = args.values.vault
  if (raw === undefined) return undefined
  const parsed = AddressSchema.safeParse(raw)
  if (!parsed.success) throw new Error('The vault address is not a valid address.')
  return parsed.data
}

function coreOf(args: Arguments): Address {
  const raw = args.values.core
  if (raw === undefined) throw new Error('The option --core is required.')
  const parsed = AddressSchema.safeParse(raw)
  if (!parsed.success) throw new Error('The core address is not a valid address.')
  return parsed.data
}

/** The reader of the registry. It only reads; it never signs and never sends anything. */
function guardOf(args: Arguments) {
  const core = coreOf(args)
  const client = publicClient(rpcUrl(args.values.rpc), chainIdOf(args))
  return guardFor(client, core, vaultOf(args))
}

export async function runScanContract(argv: readonly string[]): Promise<RunResult> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) return failure(parsed.message, SCAN_CONTRACT_USAGE)
  const address = parsed.args.positionals[0]
  if (!address) return failure('Give the address of the contract.', SCAN_CONTRACT_USAGE)
  const validated = AddressSchema.safeParse(address)
  if (!validated.success) return failure('The address of the contract is not a valid address.', SCAN_CONTRACT_USAGE)
  try {
    const output = await scanContractReport({ address: validated.data, guard: guardOf(parsed.args) })
    return { code: 0, output }
  } catch (error) {
    return { code: 1, output: `The check could not be completed: ${message(error)}` }
  }
}

export async function runScanSkill(argv: readonly string[]): Promise<RunResult> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) return failure(parsed.message, SCAN_SKILL_USAGE)
  const folder = parsed.args.positionals[0]
  if (!folder) return failure('Give the folder of the skill bundle.', SCAN_SKILL_USAGE)
  try {
    const output = await scanSkillReport({ folder, guard: guardOf(parsed.args) })
    return { code: 0, output }
  } catch (error) {
    return { code: 1, output: `The check could not be completed: ${message(error)}` }
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
  const bytes = new Uint8Array(await readFile(file))
  return { hash: keccak256(bytes), uri }
}

/** The bytes32 the contract takes: the address as bytes32, or the canonical bundle hash. */
function attestationTarget(args: Arguments, entries?: readonly BundleEntry[]): AttestationTarget {
  const folder = args.values.skill
  if (folder !== undefined && entries) {
    const identity = bundleIdentity(entries)
    return {
      type: 'AI_SKILL_BUNDLE',
      target: identity.canonicalBundleHash,
      targetId: targetIdOfSkill(identity.canonicalBundleHash),
      label: folder,
      address: null,
    }
  }
  const address = args.positionals[0]
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

/** What the registry says today. A registry that cannot be read leaves the summary unknown. */
async function summaryOf(args: Arguments, target: AttestationTarget, entries?: readonly BundleEntry[]) {
  try {
    const guard = guardOf(args)
    const signal = await guard.signal(target.targetId)
    const tier = target.type === 'SMART_CONTRACT' && target.address
      ? (await guard.checkContract(target.address)).tier
      : (await guard.checkSkill(entries ?? [])).tier
    return { tier, signal }
  } catch {
    return undefined
  }
}

export async function runPrepareAttestation(argv: readonly string[]): Promise<RunResult> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) return failure(parsed.message, PREPARE_ATTESTATION_USAGE)
  const args = parsed.args
  const verdictRaw = args.values.verdict
  if (verdictRaw === undefined) return failure('The option --verdict is required.', PREPARE_ATTESTATION_USAGE)
  const verdict = VerdictSchema.safeParse(verdictRaw.toUpperCase())
  if (!verdict.success) return failure('The verdict must be SAFE, CAUTION or DANGER.', PREPARE_ATTESTATION_USAGE)
  try {
    const { flags, names } = flagsOf(args)
    const evidence = await evidenceOf(args)
    const proof = args.values.proof ?? ''
    const entries = args.values.skill === undefined ? undefined : await readFolder(args.values.skill)
    const target = attestationTarget(args, entries)
    if (!isValidFlags(target.type, verdict.data, flags)) {
      return failure(`The flags ${names.join(', ') || 'none'} do not fit the verdict ${verdict.data}.`, PREPARE_ATTESTATION_USAGE)
    }
    const summary = await summaryOf(args, target, entries)
    const output = prepareAttestationReport({
      target,
      verdict: verdict.data as Verdict,
      flags,
      shortProof: proof,
      evidenceHash: evidence.hash,
      evidenceURI: evidence.uri,
      ...(summary ? { summary } : {}),
    })
    return { code: 0, output }
  } catch (error) {
    return { code: 1, output: `The parameters could not be prepared: ${message(error)}` }
  }
}
