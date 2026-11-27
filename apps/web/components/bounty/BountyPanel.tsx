'use client'
import { useId, useRef, useState } from 'react'
import type { Hex } from 'viem'
import { CONSTANTS } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { ConnectSection } from '../wallet/ConnectSection'
import { WrongNetwork } from '../wallet/WrongNetwork'
import { modulesLive } from '../../lib/chain/config'
import { moduleGate } from '../../lib/chain/modules'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { formatBnb } from '../../lib/format'
import { parseBnb } from '../../lib/publish/bond'
import { SLOT_RANGE, bountyCap, refundDays, slotChoices, treasuryShare, withinBountyBounds } from '../../lib/bounty/settle'
import { useBounty } from '../../lib/bounty/useBounty'
import { WriteStates } from './WriteStates'

export type BountyPanelProps = {
  targetId: string
  /** The name of the target, as the page shows it. */
  label?: string
  /** Whether the dialog is shown. */
  open?: boolean
  onClose: () => void
}

/** The slots a bounty may have, as a radio group with the arrow keys of the radio pattern. */
function SlotChoice({
  slots,
  hintId,
  onChoose,
}: {
  slots: number
  /** The id of the line that explains how many slots a bounty may have. */
  hintId: string
  onChoose: (slots: number) => void
}) {
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
    <section role="radiogroup" aria-label={copy.bounty.slotsLabel} aria-describedby={hintId} className="sf-stack">
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
  hintId: string
  onSlots: (slots: number) => void
  onAmount: (amount: string) => void
}) {
  return (
    <div className="sf-stack">
      <div className="sf-field">
        <span className="sf-field__label">{copy.bounty.slotsLabel}</span>
        <SlotChoice slots={props.slots} hintId={props.hintId} onChoose={props.onSlots} />
      </div>
      <p className="sf-lead" id={props.hintId}>
        {copy.bounty.slotsHint.replace('{min}', String(SLOT_RANGE.min)).replace('{max}', String(SLOT_RANGE.max))}
      </p>
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
      {props.error !== null && (
        <p role="alert" className="sf-error">
          {props.error}
        </p>
      )}
    </div>
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
  const [slots, setSlots] = useState<number>(SLOT_RANGE.min)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hintId = useId()
  const { status, error: writeError, txHash, createBounty } = useBounty()
  const gate = moduleGate(modulesLive)
  const wei = parseBnb(amount)
  // The account signs the write, so it is named in the request. A wallet on the wrong network
  // has no usable account here, so it needs the switch first.
  const account = 'address' in user ? user.address : null
  const connected = account !== null && user.kind !== 'wrong-network'
  const busy = status === 'signing' || status === 'pending'

  async function fund(): Promise<void> {
    if (slots < SLOT_RANGE.min || slots > SLOT_RANGE.max) {
      setError(copy.bounty.slotsInvalid.replace('{min}', String(SLOT_RANGE.min)).replace('{max}', String(SLOT_RANGE.max)))
      return
    }
    if (wei === null || wei <= 0n) {
      setError(copy.bounty.amountInvalid)
      return
    }
    if (wei > CONSTANTS.MAX_BOUNTY) {
      setError(copy.errors.BountyAboveCap)
      return
    }
    if (!withinBountyBounds(slots, wei)) {
      setError(copy.bounty.boundsInvalid)
      return
    }
    if (account === null) return
    setError(null)
    await createBounty(account, targetId as Hex, slots, wei)
  }

  return (
    <Panel title={copy.target.fundBounty} onClose={onClose} closeDisabled={busy}>
      {gate.disabled && <p className="sf-lead">{gate.reason}</p>}
      <Summary amount={wei !== null && wei > 0n ? formatBnb(wei) : null} />
      {!gate.disabled && user.kind === 'no-wallet' && <ConnectSection what={copy.bounty.walletNeeded} />}
      {!gate.disabled && user.kind === 'wrong-network' && <WrongNetwork />}
      {!gate.disabled && connected && (
        <div className="sf-stack">
          {label !== undefined && <p className="sf-lead">{label}</p>}
          <BountyForm
            slots={slots}
            amount={amount}
            error={error}
            hintId={hintId}
            onSlots={setSlots}
            onAmount={setAmount}
          />
          <WriteStates status={status} error={writeError} txHash={txHash} onRetry={() => void fund()} />
          {/* The button is the only primary action of the panel, and it is locked while the
              transaction is on its way and after it landed. */}
          <footer className="sf-panel__footer">
            {(status === 'idle' || busy) && (
              <Button variant="primary" disabled={busy} onClick={() => void fund()}>
                {busy ? copy.attest.pending : copy.bounty.create}
              </Button>
            )}
          </footer>
        </div>
      )}
    </Panel>
  )
}
