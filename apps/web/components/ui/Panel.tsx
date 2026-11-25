"use client"
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { copy } from '../../lib/copy'
export function Panel({
  title,
  marker,
  onClose,
  children,
}: {
  title: string
  /** A short step marker in the header, such as "1 of 2". */
  marker?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="sf-panel" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}>
    <header>
      <h2 id={titleId}>{title}</h2>
      {marker !== undefined && <span className="sf-mono">{marker}</span>}
      <Button variant="ghost" onClick={onClose}>{copy.common.close}</Button>
    </header>
    <div className="sf-panel__body">{children}</div>
  </dialog>
}
