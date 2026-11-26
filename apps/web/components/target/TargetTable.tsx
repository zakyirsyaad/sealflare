import type { ReactNode } from 'react'
import { Table, type TableColumn, type TableRow } from '../ui/Table'

export type { TableColumn, TableRow }

/**
 * The table every list page uses.
 *
 * There is one table, so Explore, the Guardians and the history of a Guardian all read the
 * same way. On a narrow screen every cell names its column, so a row becomes a card and
 * nothing is lost on the way.
 */
export function TargetTable({
  caption,
  columns,
  rows,
  footer,
}: {
  caption: string
  columns: readonly TableColumn[]
  rows: readonly TableRow[]
  /** The line under the table: the count of the list and the way through the pages. */
  footer?: ReactNode
}) {
  return (
    <section className="sf-frame sf-list">
      <Table caption={caption} columns={columns} rows={rows} />
      {footer !== undefined && <div className="sf-list__footer">{footer}</div>}
    </section>
  )
}
