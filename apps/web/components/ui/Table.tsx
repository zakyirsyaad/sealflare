import type { ReactNode } from 'react'
export type TableColumn = { key: string; label: string }
export type TableRow = { id: string; cells: Record<string, ReactNode> }
export function Table({ caption, columns, rows }: { caption: string; columns: readonly TableColumn[]; rows: readonly TableRow[] }) {
  return <table className="sf-table"><caption>{caption}</caption>
    <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key} data-label={column.label}>{row.cells[column.key]}</td>)}</tr>)}</tbody>
  </table>
}
