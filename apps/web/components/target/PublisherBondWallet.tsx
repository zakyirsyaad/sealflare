'use client'
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { zeroAddress, type Address, type Hex } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { Button } from '../ui/Button'
import { expectedChainId, modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { copy } from '../../lib/copy'
import { formatBnb, formatUtc } from '../../lib/format'
import { bondRange, bondTerms, parseBnb } from '../../lib/publish/bond'
import { useBond, vaultAddress } from '../../lib/publish/useBond'

export type PublisherBondWalletProps = {
  targetId: Hex
  publisher: Address | null
  /** The wallet that is connected. */
  address: Address
}

/**
 * The bond of the connected wallet and the actions on it. Every write comes from that wallet and
 * the bond is BNB that goes straight to the vault, so no token is ever approved.
 */
export function PublisherBondWallet({ targetId, publisher, address }: PublisherBondWalletProps) {
  const { state, deposit, requestWithdrawal, finalizeWithdrawal } = useBond()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const vault = vaultAddress()
  const gate = moduleGate(modulesLive)
  const own = useReadContract({
    address: vault ?? zeroAddress,
    abi: vaultAbi,
    functionName: 'bondOf',
    args: [targetId, address],
    chainId: expectedChainId,
    query: { enabled: vault !== null },
  })
  const ownAmount = own.data?.amount ?? 0n
  const availableAt = Number(own.data?.withdrawalAvailableAt ?? 0)
  const locked = (own.data?.lockedByChallengeId ?? 0n) > 0n
  const now = Math.floor(Date.now() / 1000)
  const ready = availableAt > 0 && availableAt <= now
  const isPublisher = publisher !== null && address.toLowerCase() === publisher.toLowerCase()
  const terms = bondTerms()
  const range = bondRange()

  /** The bond is read again once the chain confirmed a write, so the buttons follow the real state. */
  async function settle(write: Promise<boolean>): Promise<void> {
    if (await write) await own.refetch()
  }

  async function post(): Promise<void> {
    const wei = parseBnb(amount)
    if (wei === null) {
      setError(copy.publish.bondInvalid)
      return
    }
    // The vault counts the bond of the depositor, so the bond that is already there counts too.
    if (wei <= 0n || ownAmount + wei > range.max) {
      setError(copy.publish.bondAboveCap.replace('{cap}', terms.cap))
      return
    }
    setError(null)
    await settle(deposit(targetId, wei))
  }

  const status = locked
    ? copy.publisher.bondLocked
    : availableAt > 0 && !ready
      ? copy.publisher.bondPending.replace('{time}', formatUtc(availableAt))
      : ready
        ? copy.publisher.bondReady
        : ownAmount === 0n
          ? copy.publisher.bondNone
          : null

  return (
    <div className="sf-stack">
      <div className="sf-tab__facts">
        <p>
          {copy.publisher.yourBond}:{' '}
          {ownAmount === 0n ? copy.publisher.bondNone : copy.publisher.bondAmount.replace('{amount}', formatBnb(ownAmount))}
        </p>
        {status !== null && <p>{status}</p>}
      </div>
      {vault === null && <p className="sf-lead">{copy.publisher.vaultMissing}</p>}
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      {isPublisher && vault !== null && (
        <label className="sf-field">
          <span className="sf-field__label">{copy.publish.bondAmount}</span>
          <input
            className="sf-scan__input mono"
            type="text"
            value={amount}
            onChange={event => setAmount(event.target.value)}
            placeholder="0.1"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <div className="sf-stack">
        {isPublisher && vault !== null && (
          <Button variant="primary" disabled={gate.disabled || state.status === 'sending'} onClick={() => void post()}>
            {copy.publisher.deposit}
          </Button>
        )}
        {!isPublisher && ownAmount === 0n && <p className="sf-lead">{copy.publisher.notPublisher}</p>}
        {ownAmount > 0n && availableAt === 0 && !locked && (
          <Button disabled={gate.disabled || state.status === 'sending'} onClick={() => void settle(requestWithdrawal(targetId))}>
            {copy.publisher.requestWithdrawal}
          </Button>
        )}
        {ready && !locked && (
          <Button disabled={gate.disabled || state.status === 'sending'} onClick={() => void settle(finalizeWithdrawal(targetId))}>
            {copy.publisher.finalizeWithdrawal}
          </Button>
        )}
      </div>
      {state.error !== null && <p role="alert">{state.error}</p>}
    </div>
  )
}
