"use client"
import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'
export type TabItem = { id: string; label: string; content: ReactNode }
export function Tabs({ label, items }: { label: string; items: readonly TabItem[] }) {
  const prefix = useId()
  const [selected, setSelected] = useState(items[0]?.id)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const active = items.find(item => item.id === selected) ?? items[0]
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index - 1 + items.length) % items.length : null
    if (next === null) return
    event.preventDefault()
    setSelected(items[next]!.id)
    refs.current[next]?.focus()
  }
  return <div><div className="sf-tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => <button key={item.id} ref={element => { refs.current[index] = element }} className="sf-tab" type="button" role="tab" id={`${prefix}-tab-${item.id}`} aria-controls={`${prefix}-panel-${item.id}`} aria-selected={active?.id === item.id} tabIndex={active?.id === item.id ? 0 : -1} onClick={() => setSelected(item.id)} onKeyDown={event => onKey(event, index)}>{item.label}</button>)}
  </div>{active && <div className="sf-tabpanel" role="tabpanel" id={`${prefix}-panel-${active.id}`} aria-labelledby={`${prefix}-tab-${active.id}`} tabIndex={0}>{active.content}</div>}</div>
}
