import type { Address, Hex } from 'viem'
import type { TargetType, TrustTier, Verdict } from '@sealflare/shared/rules'
import type { ScanReport } from '@sealflare/shared/schemas'

/** The states of an attestation, from the summary to the vote on the chain. */
export type AttestState = 'idle' | 'signing-evidence' | 'uploading' | 'signing-tx' | 'pending' | 'failed' | 'done'

/** The wallet or the chain is still working on the vote, so the panel cannot be left. */
export function isWorking(state: AttestState): boolean {
  return state === 'signing-evidence' || state === 'uploading' || state === 'signing-tx' || state === 'pending'
}

/**
 * The panel is locked while the work may not be left behind.
 *
 * While the evidence is signed, the user may leave: the attempt stops before the evidence is
 * pinned and before the transaction is sent. From the moment the transaction is asked for, the
 * hash may arrive at any time, so the panel stays until the receipt is read.
 */
export function isLocked(state: AttestState): boolean {
  return state === 'uploading' || state === 'signing-tx' || state === 'pending'
}

export type AttestInput = {
  verdict: Verdict
  flags: number
  /** The quote the Guardian wrote for every flag the scanner did not find. */
  quotes: Record<string, string>
}

export type AttestTarget = {
  targetId: string
  targetType: TargetType
  /** The word `Core.attest` takes. Null when the target is not known yet. */
  targetWord: string | null
  tier: TrustTier
  /** The scan of this very target, when the page has one. */
  scan: ScanReport | null
  /** The address that votes. Null when no wallet is connected. */
  address: Address | null
}

/** The outcome of one step. A refusal in the wallet returns to the summary without an error. */
export type Step<T> = { ok: true; value: T } | { ok: false; state: 'idle' | 'failed'; message?: string }

/** The hash of a transaction, as viem writes it. */
export type TxHash = Hex
