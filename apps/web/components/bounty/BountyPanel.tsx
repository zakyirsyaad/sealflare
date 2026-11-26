'use client'
import { useState } from 'react'
import { useConnect, useConnectors } from 'wagmi'
import type { Hex } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { parseBnb } from '../../lib/publish/bond'
import { SLOT_RANGE, bountyCap, refundDays, slotChoices, treasuryShare } from '../../lib/bounty/settle'
import { useBounty } from '../../lib/bounty/useBounty'

export type BountyPanelProps = {
  targetId: string
  /** The name of the target, as the page shows it. */
  label?: string
  /** Whether the dialog is shown. The page keeps it mounted while it is closed. */
  open?: boolean
  onClose: () => void
}

/** The wallet has to be connected before anything can be signed. */
function ConnectSection() {
  const connectors = useConnectors()
  const { mutate, isPending } = useConnect()
  return (
    <section className="sf-stack">
      <h3 className="sf-stack__title">{copy.wallet.connectTitle}</h3>
      <p className="sf-lead">{copy.bounty.walletNeeded}</p>
      <ul className="sf-connectors">
        {connectors.map(connector => (
          <li key={connector.uid}>
            <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector })}>
              {connector.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The slots a bounty may have, as a radio group. */
function SlotChoice({ slots, onChoose }: { slots: number; onChoose: (slots: number) => void }) {
  return (
    <section role="radiogroup" aria-label={copy.bounty.slotsLabel} className="sf-stack">
      {slotChoices().map(choice => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={slots === choice}
          className="sf-opt"
          onClick={() => onChoose(choice)}
        >
          <span aria-hidden="true" className="sf-opt__marker" />
          <span className="sf-opt__title">{choice}</span>
        </button>
      ))}
    </section>
  )
}

/** What happens to the money, told before the wallet is opened. */
function Summary({ amount }: { amount: string | null }) {
  return (
    <section className="sf-stack">
      <h3 className="sf-stack__title">{copy.bounty.summaryTitle}</h3>
      <ul className="sf-stack">
        <li>{copy.bounty.factMajority}</li>
        <li>{copy.bounty.factTreasury.replace('{fee}', String(treasuryShare()))}</li>
        <li>{copy.bounty.factNoCancel}</li>
        <li>{copy.bounty.factRefund.replace('{days}', String(refundDays()))}</li>
        <li>{copy.bounty.factRequester}</li>
      </ul>
      {amount !== null && <p className="sf-mono">{copy.bounty.amount.replace('{amount}', amount)}</p>}
    </section>
  )
}

/**
 * The panel that funds a bounty.
 *
 * The dialog is only mounted while it is open, so a closed panel reads nothing from the chain.
 */
export function BountyPanel({ targetId, label, open = true, onClose }: BountyPanelProps) {
  if (!open) return null
  return <BountyBody targetId={targetId} label={label} onClose={onClose} />
}

/**
 * The body of the panel.
 *
 * A bounty needs a wallet, but not an Agent ID: anybody may ask for an audit of a target. The
 * slots and the amount are checked here and again by the contract, and the amount that is sent
 * is exactly the amount that is shown.
 */
function BountyBody({ targetId, label, onClose }: Omit<BountyPanelProps, 'open'>) {
  const user = useUserState()
  const [slots, setSlots] = useState(SLOT_RANGE.min)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { state, createBounty } = useBounty()
  const gate = moduleGate(modulesLive)
  const cap = bountyCap()

  const connected = user.kind !== 'no-wallet' && user.kind !== 'wrong-network'
  const wei = parseBnb(amount)

  async function fund(): Promise<void> {
    if (wei === null || wei <= 0n) {
      setError(copy.bounty.amountInvalid)
      return
    }
    if (wei > CONSTANTS.MAX_BOUNTY) {
      setError(copy.bounty.aboveCap.replace('{cap}', cap))
      return
    }
    setError(null)
    await createBounty(targetId as Hex, slots, wei)
  }

  return (
    <Panel title={copy.target.fundBounty} onClose={onClose}>
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      {!gate.disabled && user.kind === 'no-wallet' && <ConnectSection />}
      {!gate.disabled && user.kind === 'wrong-network' && <WrongNetwork />}
      {!gate.disabled && connected && (
        <div className="sf-stack">
          {label !== undefined && <p className="sf-lead">{label}</p>}
          <div className="sf-field">
            <span className="sf-field__label">{copy.bounty.slotsLabel}</span>
            <SlotChoice slots={slots} onChoose={setSlots} />
          </div>
          <p className="sf-lead">{copy.bounty.slotsHint.replace('{min}', String(SLOT_RANGE.min)).replace('{max}', String(SLOT_RANGE.max))}</p>
          <label className="sf-field">
            <span className="sf-field__label">{copy.bounty.amountLabel}</span>
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
          <p className="sf-lead">{copy.bounty.amountHint.replace('{cap}', cap)}</p>
          {error !== null && <p role="alert">{error}</p>}
          {state.error !== null && <p role="alert">{state.error}</p>}
          {state.status === 'done' && <p>{copy.common.waitingFinality}</p>}
          <Summary amount={wei !== null && wei > 0n ? formatBnb(wei) : null} />
          <Button variant="primary" disabled={state.status === 'sending'} onClick={() => void fund()}>
            {copy.bounty.create}
          </Button>
        </div>
      )}
    </Panel>
  )
}
