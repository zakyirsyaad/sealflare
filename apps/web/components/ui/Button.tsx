import type { ButtonHTMLAttributes } from 'react'
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }
export function Button({ variant = 'secondary', type = 'button', className = '', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`sf-btn sf-btn--${variant} ${className}`} />
}
