'use client'
import type { FormEvent } from 'react'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type ScanFieldProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy?: boolean
}

/** The one field of the Scan screen. It works with the keyboard alone: Enter submits. */
export function ScanField({ value, onChange, onSubmit, busy = false }: ScanFieldProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy) onSubmit()
  }
  return (
    <form className="sf-scan" onSubmit={submit}>
      <label className="sf-sr-only" htmlFor="scan-target">{copy.scan.fieldLabel}</label>
      <input
        id="scan-target"
        className="sf-scan__input mono"
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={copy.scan.placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={busy}
      />
      <Button type="submit" variant="primary" className="sf-btn--lg" disabled={busy}>
        {copy.scan.action}
      </Button>
    </form>
  )
}
