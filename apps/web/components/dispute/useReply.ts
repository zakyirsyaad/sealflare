'use client'
import type { Address } from 'viem'
import { courtAbi } from '@sealflare/shared/abi'
import { courtAddress } from '../../lib/chain/court'
import { copy } from '../../lib/copy'
import { buildReplyReport, prepareEvidence } from './evidence'
import { useEvidenceFlow } from './useEvidenceFlow'

export type ReplyTarget = {
  challengeId: string
  targetId: string
  /** The address that replies. Null when no wallet is connected. */
  address: Address | null
}

/**
 * The reply of the verified publisher.
 *
 * The statement is signed and pinned first, and only then is `submitCounterEvidence` asked for,
 * with the URI of the pinned reply. The Court itself refuses any wallet but the verified publisher.
 */
export function useReply(target: ReplyTarget) {
  const flow = useEvidenceFlow()

  const submit = async (statement: string) => {
    const court = courtAddress()
    if (target.address === null) return flow.fail(copy.wallet.agentRequired)
    if (court === null) return flow.fail(copy.dispute.noCourt)
    const author = target.address
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

  return { state: flow.state, error: flow.error, txHash: flow.txHash, reset: flow.reset, submit }
}
