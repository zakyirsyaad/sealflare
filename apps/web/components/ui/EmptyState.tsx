import type { ReactNode } from 'react'
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return <section className="sf-empty"><h2>{title}</h2>{action}</section>
}
