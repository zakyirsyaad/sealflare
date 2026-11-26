'use client'
import { useRef, useState } from 'react'
import { useConnect, useConnectors } from 'wagmi'
import type { Hex } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { TransactionLink } from '../attest/AttestButton'
import { modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { parseBnb } from '../../lib/publish/bond'
import { SLOT_RANGE, bountyCap, refundDays, slotChoices, treasuryShare, withinBountyBounds } from '../../lib/bounty/settle'
import { useBounty } from '../../lib/bounty/useBounty'

export type BountyPanelProps = {
  targetId: string
  /** The name of the target, as the page shows it. */
  label?: string
  /** Whether the dialog is shown. */
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

/** The slots a bounty may have, as a radio group with the arrow keys of the radio pattern. */
function SlotChoice({ slots, onChoose }: { slots: number; onChoose: (slots: number) => void }) {
  const choices = slotChoices()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  function move(index: number, step: number): void {
    const next = (index + step + choices.length) % choices.length
    onChoose(choices[next]!)
    buttons.current[next]?.focus()
  }
  function onKeyDown(index: number, event: React.KeyboardEvent): void {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
    if (!forward && !back) return
    event.preventDefault()
    move(index, forward ? 1 : -1)
  }
  return (
    <section role="radiogroup" aria-label={copy.bounty.slotsLabel} className="sf-stack">
      {choices.map((choice, index) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={slots === choice}
          tabIndex={slots === choice ? 0 : -1}
          className="sf-opt"
          ref={element => {
            buttons.current[index] = element
          }}
          onClick={() => onChoose(choice)}
          onKeyDown={event => onKeyDown(index, event)}
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

/** The slots and the amount of the bounty. */
function BountyForm(props: {
  slots: number
  amount: string
  error: string | null
  onSlots: (slots: number) => void
  onAmount: (amount: string) => void
}) {
  return (
    <div className="sf-stack">
      <div className="sf-field">
        <span className="sf-field__label">{copy.bounty.slotsLabel}</span>
        <SlotChoice slots={props.slots} onChoose={props.onSlots} />
      </div>
      <p className="sf-lead">{copy.bounty.slotsHint.replace('{min}', String(SLOT_RANGE.min)).replace('{max}', String(SLOT_RANGE.max))}</p>
      <label className="sf-field">
        <span className="sf-field__label">{copy.bounty.amountLabel}</span>
        <input
          className="sf-input"
          type="text"
          value={props.amount}
          onChange={event => props.onAmount(event.target.value)}
          placeholder={copy.bounty.amountPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="sf-lead">{copy.bounty.amountHint.replace('{cap}', bountyCap())}</p>
      <p className="sf-lead">{copy.bounty.agentNotNeeded}</p>
      {props.error !== null && <p role="alert">{props.error}</p>}
    </div>
  )
}

/** The states of the write: it is on its way, it failed, or it landed. */
function WriteStates({ status, error, txHash, onRetry }: { status: string; error: string | null; txHash: string | null; onRetry: () => void }) {
  if (status === 'done') {
    return (
      <div className="sf-stack">
        <p>{copy.common.waitingFinality}</p>
        {txHash !== null && <TransactionLink txHash={txHash}>{copy.target.transaction}</TransactionLink>}
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="sf-stack">
        <p role="alert">{error ?? copy.errors.unknown}</p>
        <Button variant="primary" onClick={onRetry}>
          {copy.common.retry}
        </Button>
      </div>
    )
  }
  return null
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
  const [slots, setSlots] = useState<number>(SLOT_RANGE.min)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { state, createBounty } = useBounty()
  const gate = moduleGate(modulesLive)
  const cap = bountyCap()
  const wei = parseBnb(amount)
  const connected = user.kind !== 'no-wallet' && user.kind !== 'wrong-network'

  async function fund(): Promise<void> {
    if (wei === null || wei <= 0n) {
      setError(copy.bounty.amountInvalid)
      return
    }
    if (wei > CONSTANTS.MAX_BOUNTY) {
      setError(copy.bounty.aboveCap.replace('{cap}', cap))
      return
    }
    if (!withinBountyBounds(slots, wei)) {
      setError(copy.bounty.amountInvalid)
      return
    }
    setError(null)
    await createBounty(targetId as Hex, slots, wei)
  }

  return (
    <Panel title={copy.target.fundBounty} onClose={onClose}>
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      <Summary amount={wei !== null && wei > 0n ? formatBnb(wei) : null} />
      {!gate.disabled && user.kind === 'no-wallet' && <ConnectSection />}
      {!gate.disabled && user.kind === 'wrong-network' && <WrongNetwork />}
      {!gate.disabled && connected && (
        <div className="sf-stack">
          {label !== undefined && <p className="sf-lead">{label}</p>}
          <BountyForm slots={slots} amount={amount} error={error} onSlots={setSlots} onAmount={setAmount} />
          <Button variant="primary" disabled={state.status !== 'idle'} onClick={() => void fund()}>
            {copy.bounty.create}
          </Button>
          <WriteStates status={state.status} error={state.error} txHash={state.txHash} onRetry={() => void fund()} />
        </div>
      )}
    </Panel>
  )
}
