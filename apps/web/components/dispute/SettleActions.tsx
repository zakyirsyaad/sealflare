'use client'
import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { coreAbi, courtAbi } from '@sealflare/shared/abi'
import { CONSTANTS } from '@sealflare/shared/rules'
import { expectedChainId } from '../../lib/chain/config'
import { coreAddress } from '../../lib/chain/addresses'
import { courtAddress, type ChallengeOutcome, type ChallengePhase } from '../../lib/chain/court'
import { useUserState } from '../../lib/chain/userState'
import { useWriteTx, type TxRequest } from '../../lib/chain/useWriteTx'
import { copy } from '../../lib/copy'
import { AttestButton } from '../attest/AttestButton'
import { buttonStateOf } from './txButtonState'

export type SettleActionsProps = {
  challengeId: string
  targetId: string
  phase: ChallengePhase | null
  outcome: ChallengeOutcome | null
  /** The reveals the Court counted. Null while the chain has not answered. */
  reveals: number | null
}

type ActionProps = { label: string; why: string; account: Address | null; request: Omit<TxRequest, 'account'> | null }

/** One action that anyone may trigger. It says that it costs gas and what it does. */
function Action({ label, why, account, request }: ActionProps) {
  const tx = useWriteTx()
  const send = () => {
    if (account !== null && request !== null) void tx.send({ ...request, account })
  }
  return (
    <section className="sf-stack">
      <p className="sf-lead">{why}</p>
      <AttestButton
        state={buttonStateOf(tx.state)}
        error={tx.error}
        txHash={tx.txHash}
        label={label}
        disabled={account === null || request === null}
        onSubmit={send}
        onRetry={() => {
          tx.reset()
          send()
        }}
      />
      <p className="sf-lead">{copy.dispute.gasNote}</p>
      {account === null && <p className="sf-lead">{copy.dispute.needWallet}</p>}
    </section>
  )
}

/** The pending penalties of the target, and how many attestations the list holds. */
function usePenalties(targetId: string, enabled: boolean): { pending: number; attestations: number } {
  const core = coreAddress()
  const base = {
    abi: coreAbi,
    address: core ?? undefined,
    chainId: expectedChainId,
    args: [targetId as `0x${string}`] as const,
    query: { enabled: enabled && core !== null },
  }
  const pending = useReadContract({ ...base, functionName: 'pendingPenalties' })
  const target = useReadContract({ ...base, functionName: 'getTarget' })
  const held = (target.data as { attestationCount?: unknown } | undefined)?.attestationCount
  return {
    pending: typeof pending.data === 'number' ? pending.data : 0,
    attestations: typeof held === 'number' ? held : 0,
  }
}

/** Applies the penalties of a danger verdict to the whole list. The contract clamps the range to the list. */
function Penalties(props: { targetId: string; account: Address | null }) {
  const { pending, attestations } = usePenalties(props.targetId, true)
  const core = coreAddress()
  if (pending === 0) return null
  return (
    <Action
      label={copy.dispute.penalties.replace('N', String(pending))}
      why={copy.dispute.penaltiesWhy}
      account={props.account}
      request={
        // With no attestation known the call would apply nothing and still cost gas.
        core === null || attestations === 0
          ? null
          : { address: core, abi: coreAbi, functionName: 'applyPenalties', args: [props.targetId, 0, attestations] }
      }
    />
  )
}

/**
 * What anyone may do to close a dispute: resolve it when enough jurors revealed, expire it when
 * too few did, and apply the penalties after a danger verdict. Each says that it costs gas.
 */
export function SettleActions(props: SettleActionsProps) {
  const user = useUserState()
  // A wallet on the wrong network has no usable address here, so it needs the switch first.
  const account = 'address' in user ? user.address : null
  const court = courtAddress()
  if (props.phase === 'AWAITING_CLOSE' && props.reveals !== null) {
    const resolvable = props.reveals >= CONSTANTS.MIN_REVEALS
    return (
      <Action
        label={resolvable ? copy.dispute.resolve : copy.dispute.expire}
        why={resolvable ? copy.dispute.resolveWhy : copy.dispute.expireWhy.replace('{min}', String(CONSTANTS.MIN_REVEALS))}
        account={account}
        request={
          court === null
            ? null
            : {
                address: court,
                abi: courtAbi,
                functionName: resolvable ? 'resolve' : 'expire',
                args: [BigInt(props.challengeId)],
              }
        }
      />
    )
  }
  if (props.phase === 'CLOSED' && props.outcome === 'UPHELD') {
    return <Penalties targetId={props.targetId} account={account} />
  }
  return null
}
