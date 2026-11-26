'use client'
import type { Address } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { courtAddress, type ChallengePhase } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import type { PublisherRole } from '../../server/disputes'
import { buildReplyReport, prepareEvidence } from './evidence'
import { useEvidenceFlow } from './useEvidenceFlow'

export type ReplyTarget = {
  challengeId: string
  targetId: string
  /** The address that replies. Null when no wallet is connected. */
  address: Address | null
  /** The phase the Court names. Null when the chain has not answered. */
  phase: ChallengePhase | null
  /** What the registry says about the publisher. Null when it could not be read. */
  publisherRole: PublisherRole | null
  /** The address of the verified publisher. Null when there is none. */
  publisher: string | null
}

/**
 * Why the reply may not be sent, or null when it may.
 *
 * The Court refuses a reply that is not in the commit phase, and a reply from anybody but the
 * verified publisher. Nothing is signed or pinned when either would be refused.
 */
export function replyBlocker(target: ReplyTarget): string | null {
  if (target.address === null) return copy.wallet.agentRequired
  if (target.phase !== 'COMMIT') return copy.dispute.replyClosed
  if (target.publisherRole === 'THIRD_PARTY_SPONSOR') return copy.dispute.sponsorCannotReply
  if (target.publisherRole !== 'VERIFIED_PUBLISHER') return copy.errors.NotPublisher
  if (target.publisher === null || target.publisher.toLowerCase() !== target.address.toLowerCase()) {
    return copy.errors.NotPublisher
  }
  return null
}

/**
 * The reply of the verified publisher.
 *
 * The statement is signed and pinned first, and only then is `submitCounterEvidence` asked for,
 * with the URI of the pinned reply. The Court itself refuses any wallet but the verified publisher,
 * so the flow checks the same things before it asks the wallet for anything.
 */
export function useReply(target: ReplyTarget) {
  const flow = useEvidenceFlow()

  const submit = async (statement: string) => {
    const court = courtAddress()
    const blocker = replyBlocker(target)
    if (blocker !== null) return flow.fail(blocker)
    if (court === null) return flow.fail(copy.dispute.noCourt)
    const author = target.address as Address
    const prepared = prepareEvidence(() => buildReplyReport({ targetId: target.targetId, author, statement }))
    if (prepared === null) return flow.fail(copy.attest.reportInvalid)
    await flow.run({
      account: author,
      prepared,
      transaction: evidenceURI => ({
        account: author,
        address: court,
        abi: courtAbi,
        functionName: 'submitCounterEvidence',
        args: [BigInt(target.challengeId), evidenceURI],
      }),
    })
  }

  return { state: flow.state, error: flow.error, txHash: flow.txHash, reset: flow.reset, submit, cancel: flow.cancel }
}
