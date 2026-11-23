import type { ReactNode } from 'react'
export function Banner({ tone, children }: { tone: 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return <div className={`sf-banner sf-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{children}</div>
}
