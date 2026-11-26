'use client'
import type { Address, Hex } from 'viem'
import { toHex } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { CONSTANTS, isValidFlags, type TargetType } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'
import { courtAddress } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { buildChallengeReport, prepareEvidence } from './evidence'
import { useEvidenceFlow } from './useEvidenceFlow'

export type ChallengeTarget = {
  targetId: string
  targetType: TargetType
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  /** The address that opens the challenge. Null when no wallet is connected. */
  address: Address | null
}

export type ChallengeInput = {
  flags: number
  /** The quote the challenger wrote for every flag the scanner did not find. */
  quotes: Record<string, string>
  statement: string
}

/** Why the challenge may not be opened, or null when it may. */
function blockerOf(target: ChallengeTarget, input: ChallengeInput, court: Address | null): string | null {
  if (target.address === null) return copy.wallet.agentRequired
  if (court === null) return copy.dispute.noCourt
  if (!isValidFlags(target.targetType, 'DANGER', input.flags)) return copy.attest.invalidFlags
  return null
}

/**
 * Opens a challenge.
 *
 * The order never changes: the report is built, checked, hashed and signed first, then pinned, and
 * only then is the transaction asked for, with exactly the stake of the contract.
 */
export function useChallenge(target: ChallengeTarget) {
  const flow = useEvidenceFlow()

  const submit = async (input: ChallengeInput) => {
    const court = courtAddress()
    const blocker = blockerOf(target, input, court)
    if (blocker !== null || target.address === null || court === null) return flow.fail(blocker ?? copy.errors.unknown)
    const author = target.address
    const prepared = prepareEvidence(trim =>
      buildChallengeReport({ targetId: target.targetId, author, ...input, scan: target.scan }, trim),
    )
    if (prepared === null) return flow.fail(copy.attest.reportInvalid)
    await flow.run({
      account: author,
      prepared,
      transaction: evidenceURI => ({
        account: author,
        address: court,
        abi: courtAbi,
        functionName: 'openChallenge',
        args: [
          target.targetId as Hex,
          input.flags,
          prepared.evidenceHash,
          toHex(new TextEncoder().encode(prepared.shortProof)),
          evidenceURI,
        ],
        value: CONSTANTS.CHALLENGE_STAKE,
      }),
    })
  }

  return { state: flow.state, error: flow.error, txHash: flow.txHash, reset: flow.reset, submit }
}
