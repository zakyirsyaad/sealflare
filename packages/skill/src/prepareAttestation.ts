import { stringToHex, type Address, type Hex } from 'viem'
import type { SignalSummary } from '@sealflare/guard'
import { CONSTANTS, FLAGS, flagNames, isValidFlags, type FlagName, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { parseShortProof } from '@sealflare/shared/schemas'
import { bullet, escapeText, field, groupLine, join, section } from './output'

export type AttestationTarget = {
  type: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** The bytes32 the contract takes: the address as bytes32, or the canonical bundle hash. */
  target: Hex
  /** The id of the target in the registry. */
  targetId: Hex
  label: string
  /** The address of a contract. It is null for a skill bundle. */
  address: Address | null
}

export type AttestationSummary = { tier: TrustTier; signal: SignalSummary }

export type AttestationInput = {
  target: AttestationTarget
  verdict: Verdict
  flags: number
  /** One line per item, in the form `FLAG @ location: excerpt`. It may be empty. */
  shortProof: string
  evidenceHash: Hex
  evidenceURI: string
  /** What the registry says today. It is missing when the registry could not be read. */
  summary?: AttestationSummary
}

export type ShortProof = { lines: string[]; bytes: Hex }

/** The flags of an attestation, by name and as the bit mask the contract takes. */
export function flagLine(flags: number): string {
  const names = flagNames(flags)
  return `${names.length > 0 ? names.join(', ') : 'none'} (0x${flags.toString(16).padStart(8, '0')})`
}

/** The mask of a list of flag names. */
export function maskOfFlags(names: readonly FlagName[]): number {
  return names.reduce((bits, name) => bits | FLAGS[name], 0)
}

/**
 * The short proof as the bytes `attest()` takes.
 *
 * Every line has to be `FLAG @ location: excerpt` with a known flag, and the flag of a line has to
 * be one of the flags of the attestation. The whole proof may not pass the limit of the contract,
 * which counts bytes of UTF-8. A proof that is too long would revert with `ShortProofTooLong`, and
 * free text would be recorded on the chain for good.
 *
 * A SAFE verdict carries no flags, so a SAFE attestation never has a proof. A proof that names a
 * flag the attestation does not carry would claim on chain that the bundle holds something the
 * attestation does not say.
 */
export function validateShortProof(text: string, flags: number, verdict: Verdict): ShortProof {
  const lines = text.split('\n').filter(line => line.length > 0)
  const items = parseShortProof(lines.join('\n'))
  if (items.length !== lines.length) {
    throw new Error('The short proof must have one line per flag in the form FLAG @ location: excerpt, with a known flag name.')
  }
  if (verdict === 'SAFE' && lines.length > 0) {
    throw new Error('A SAFE attestation has no flags, so it has no short proof.')
  }
  const outside = items.filter(item => (flags & FLAGS[item.flag]) === 0)
  if (outside.length > 0) {
    throw new Error(`The short proof names ${outside.map(item => item.flag).join(', ')}, which the flags of the attestation do not carry.`)
  }
  const proof = lines.join('\n')
  const size = new TextEncoder().encode(proof).length
  if (size > CONSTANTS.SHORT_PROOF_MAX_BYTES) {
    throw new Error(`The short proof is ${size} bytes. The limit is ${CONSTANTS.SHORT_PROOF_MAX_BYTES} bytes.`)
  }
  return { lines, bytes: proof.length === 0 ? '0x' : stringToHex(proof) }
}

/**
 * The parameters of an attestation and a summary of what the registry says today.
 *
 * The script stops here. It never signs and never sends anything: the wallet of the Guardian does
 * that, after the Guardian has read the summary.
 */
export function prepareAttestationReport(input: AttestationInput): string {
  if (!isValidFlags(input.target.type, input.verdict, input.flags)) {
    throw new Error(`The flags ${input.flags} do not fit the verdict ${input.verdict} of a ${input.target.type}.`)
  }
  const proof = validateShortProof(input.shortProof, input.flags, input.verdict)
  const lines = [
    `Sealflare attestation for ${escapeText(input.target.label)}`,
    field('Target type', input.target.type),
    field('Target', input.target.target),
    field('Target id', input.target.targetId),
    field('Verdict', input.verdict),
    field('Flags', flagLine(input.flags)),
    field('Evidence hash', input.evidenceHash),
    proof.lines.length > 0 ? section('Short proof text', proof.lines.map(bullet)) : 'Short proof text: ""',
    field('Short proof bytes', proof.bytes),
    field('Evidence URI', input.evidenceURI.length > 0 ? input.evidenceURI : '""'),
  ]
  const summary: string[] = []
  if (input.summary) {
    summary.push(`The registry rates this target as ${input.summary.tier}.`)
    summary.push(groupLine('New Agent IDs', input.summary.signal.newIds))
    summary.push(groupLine('Guardians', input.summary.signal.guardians))
  } else {
    summary.push('The registry could not be read, so the current tier is unknown.')
  }
  lines.push(section('Summary', summary.map(bullet)))
  lines.push('Nothing was signed and nothing was sent. Read the summary, then sign and send attest() from your wallet.')
  return join(lines)
}
