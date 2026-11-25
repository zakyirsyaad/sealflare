'use client'
import Link from 'next/link'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useDisconnect } from 'wagmi'
import { Chip } from '../ui/Chip'
import { copy } from '../../lib/copy'

// onClose(true) returns focus to the button; Tab passes false so focus moves on to the next element.
export function WalletMenu({ pendingCount, onClose }: { pendingCount: number; onClose: (restoreFocus: boolean) => void }) {
  const { mutate: disconnect } = useDisconnect()
  const ref = useRef<HTMLDivElement>(null)
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  useEffect(() => { items()[0]?.focus() }, [])
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') return onClose(true)
    if (event.key === 'Tab') return onClose(false)
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    list[(index + step + list.length) % list.length]?.focus()
  }
  return <div ref={ref} role="menu" aria-label={copy.wallet.menuLabel} className="sf-menu" onKeyDown={onKeyDown}>
    <Link role="menuitem" href="/app/me" onClick={() => onClose(true)}>
      {copy.nav.activity}{pendingCount > 0 && <Chip className="sf-chip--count">{pendingCount}</Chip>}
    </Link>
    <Link role="menuitem" href="/app/publish" onClick={() => onClose(true)}>{copy.nav.publish}</Link>
    <button role="menuitem" type="button" onClick={() => { disconnect(); onClose(true) }}>{copy.nav.disconnect}</button>
  </div>
}
