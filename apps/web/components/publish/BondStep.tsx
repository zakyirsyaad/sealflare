'use client'
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { zeroAddress, type Address, type Hex } from 'viem'
import { vaultAbi } from '@sealflare/shared/abi'
import { Button } from '../ui/Button'
import { expectedChainId, modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { copy } from '../../lib/copy'
import { bondRange, bondTerms, parseBnb } from '../../lib/publish/bond'
import { vaultAddress } from '../../lib/chain/addresses'
import { useBond } from '../../lib/publish/useBond'

export type BondStepProps = {
  targetId: Hex
  /** The wallet that is connected. It is the one that posts the bond. */
  connected: Address | null
  onDone: () => void
}

/**
 * The warranty bond is optional. The terms are read from the constants of the contracts, never
 * written out here, and the step can be skipped and done later from the Publisher tab.
 */
export function BondStep({ targetId, connected, onDone }: BondStepProps) {
  const { state, deposit: depositBond } = useBond()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)
  const terms = bondTerms()
  const range = bondRange()
  const gate = moduleGate(modulesLive)
  const vault = vaultAddress()
  const bond = useReadContract({
    address: vault ?? zeroAddress,
    abi: vaultAbi,
    functionName: 'bondOf',
    args: [targetId, connected ?? zeroAddress],
    chainId: expectedChainId,
    query: { enabled: vault !== null && connected !== null },
  })
  const posted = bond.data?.amount ?? 0n

  async function deposit() {
    const wei = parseBnb(amount)
    if (wei === null) {
      setError(copy.publish.bondInvalid)
      return
    }
    // The vault counts the bond of the depositor, so the bond that is already there counts too.
    if (wei <= 0n || posted + wei > range.max) {
      setError(copy.publish.bondAboveCap.replace('{cap}', terms.cap))
      return
    }
    setError(null)
    const done = await depositBond(targetId, wei)
    if (done) onDone()
  }

  return (
    <section className="sf-stack" aria-label={copy.publish.stepBond}>
      <p>{copy.publish.bondTerms.replace('{cap}', terms.cap).replace('{days}', String(terms.days)).replace('{slash}', terms.slash)}</p>
      <p className="sf-lead">{copy.publish.bondWindow.replace('{hours}', String(terms.responseHours))}</p>
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
      {error !== null && <p role="alert">{error}</p>}
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      <div className="sf-stack">
        <Button variant="primary" disabled={gate.disabled || state.status === 'sending'} onClick={() => void deposit()}>
          {copy.publish.deposit}
        </Button>
        <Button variant="ghost" onClick={() => {
          setSkipped(true)
          onDone()
        }}>
          {copy.publish.bondSkip}
        </Button>
      </div>
      {skipped && <p className="sf-lead">{copy.publish.bondSkipped}</p>}
      {state.error !== null && <p role="alert">{state.error}</p>}
    </section>
  )
}
