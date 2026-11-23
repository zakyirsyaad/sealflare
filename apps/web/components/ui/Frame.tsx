import type { HTMLAttributes } from 'react'
export function Frame({ crop = false, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { crop?: boolean }) {
  return <div {...props} className={`sf-frame ${crop ? 'sf-frame--crop' : ''} ${className}`} />
}
