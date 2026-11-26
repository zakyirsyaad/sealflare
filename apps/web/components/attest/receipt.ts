import { useEffect, useState } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'
import { isAddressEqual, type Address, type Hex } from 'viem'
import { expectedChainId } from '../../lib/chain/config'
import { translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'
import type { AttestState } from './attest'
import { coreAddress } from './report'

/**
 * Whether a receipt is the receipt of the vote.
 *
 * When a transaction is replaced, the wait resolves with the receipt of the replacement. A Cancel in
 * the wallet is a transfer of nothing to the account itself on the same nonce, and its receipt has
 * the status success. Only a receipt that succeeded and went to the registry is a vote.
 */
function isVoteReceipt(receipt: { status: string; to: Address | null }): boolean {
  const core = coreAddress()
  return receipt.status === 'success' && core !== null && receipt.to !== null && isAddressEqual(receipt.to, core)
}

/** A replacement that is no speed-up is another transaction, so it is no proof of this vote. */
type Replacement = { hash: Hex; reason: string }

/**
 * Watches the receipt of the vote. A reverted transaction names its own reason.
 *
 * The hash that lands is the hash of the receipt, not the hash that was sent. A speed-up is a new
 * transaction, and the old one was dropped, so a link to the old hash would point at nothing.
 */
export function useReceipt(
  state: AttestState,
  txHash: Hex | null,
  done: (hash: Hex) => void,
  fail: (message: string) => void,
) {
  const [replaced, setReplaced] = useState<Replacement | null>(null)
  const receipt = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: expectedChainId,
    onReplaced: replacement => {
      if (txHash !== null) setReplaced({ hash: txHash, reason: replacement.reason })
    },
  })
  useEffect(() => {
    if (state !== 'pending') return
    if (replaced !== null && replaced.hash === txHash && replaced.reason !== 'repriced') {
      fail(copy.attest.replaced)
      return
    }
    if (receipt.isSuccess) {
      if (receipt.data !== undefined && isVoteReceipt(receipt.data)) {
        done(receipt.data.transactionHash)
        return
      }
      fail(receipt.data?.status === 'reverted' ? copy.attest.reverted : copy.attest.replaced)
      return
    }
    if (receipt.isError) {
      const translated = translateContractError(receipt.error)
      fail(translated?.message ?? copy.errors.unknown)
    }
  }, [state, txHash, replaced, receipt.isSuccess, receipt.data, receipt.isError, receipt.error, done, fail])
}
