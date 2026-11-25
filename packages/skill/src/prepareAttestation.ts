import type { Address, Hex } from 'viem'
import type { SignalSummary } from '@sealflare/guard'
import { FLAGS, flagNames, isValidFlags, type FlagName, type TrustTier, type Verdict } from '@sealflare/shared/rules'
import { bullet, field, groupLine, join, section } from './output'

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
  shortProof: string
  evidenceHash: Hex
  evidenceURI: string
  /** What the registry says today. It is missing when the registry could not be read. */
  summary?: AttestationSummary
}

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
 * The parameters of an attestation and a summary of what the registry says today.
 *
 * The script stops here. It never signs and never sends anything: the wallet of the Guardian does
 * that, after the Guardian has read the summary.
 */
export function prepareAttestationReport(input: AttestationInput): string {
  if (!isValidFlags(input.target.type, input.verdict, input.flags)) {
    throw new Error(`The flags ${input.flags} do not fit the verdict ${input.verdict} of a ${input.target.type}.`)
  }
  const lines = [
    `Sealflare attestation for ${input.target.label}`,
    field('Target type', input.target.type),
    field('Target', input.target.target),
    field('Target id', input.target.targetId),
    field('Verdict', input.verdict),
    field('Flags', flagLine(input.flags)),
    field('Evidence hash', input.evidenceHash),
    field('Short proof', input.shortProof.length > 0 ? input.shortProof : 'none'),
    field('Evidence URI', input.evidenceURI.length > 0 ? input.evidenceURI : 'none'),
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
