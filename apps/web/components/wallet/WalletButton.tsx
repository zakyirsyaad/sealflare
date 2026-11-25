'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { ConnectPrompt } from './ConnectPrompt'
import { WalletMenu } from './WalletMenu'
import { WrongNetwork } from './WrongNetwork'
import { useUserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'

const pendingLabel = (count: number) => (count === 1 ? copy.wallet.pendingOne : copy.wallet.pendingMany.replace('{count}', String(count)))

export function WalletButton({ pendingCount = 0 }: { pendingCount?: number }) {
  const state = useUserState()
  const [prompt, setPrompt] = useState(false)
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const closeMenu = (restoreFocus: boolean) => {
    setMenu(false)
    if (restoreFocus) root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
  }
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])
  useEffect(() => { if (state.kind !== 'no-wallet') setPrompt(false) }, [state.kind])

  if (state.kind === 'wrong-network') return <WrongNetwork />
  if (state.kind === 'no-wallet' && state.isLoading) return <Button disabled>{copy.common.loading}</Button>
  if (state.kind === 'no-wallet') {
    return <>
      <Button onClick={() => setPrompt(true)}>{copy.nav.connectWallet}</Button>
      {prompt && <ConnectPrompt onClose={() => setPrompt(false)} />}
    </>
  }
  const short = shortAddress(state.address)
  return <div
    ref={root}
    className="sf-wallet"
    onBlur={event => { if (menu && !root.current?.contains(event.relatedTarget as Node | null)) setMenu(false) }}
  >
    <Button
      aria-haspopup="menu"
      aria-expanded={menu}
      aria-label={pendingCount > 0 ? `${short}, ${pendingLabel(pendingCount)}` : undefined}
      onClick={() => setMenu(open => !open)}
    >
      <span className="sf-mono">{short}</span>
      {pendingCount > 0 && <Chip className="sf-chip--count">{pendingCount}</Chip>}
    </Button>
    {menu && <WalletMenu pendingCount={pendingCount} onClose={() => closeMenu(true)} />}
  </div>
}
