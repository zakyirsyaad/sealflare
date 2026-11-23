import type { HTMLAttributes } from 'react'
export function Chip({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`sf-chip ${className}`} />
}
