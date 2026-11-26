import Link from 'next/link'
import { copy } from '../../lib/copy'

/**
 * The way through the pages of a list.
 *
 * The number of pages comes from the total the server counted, so the reader never walks onto
 * a page that does not exist.
 */
export function PageLinks({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  const label = copy.explore.page.replace('{page}', String(page)).replace('{pages}', String(pages))
  return (
    <nav className="sf-list__pages" aria-label={copy.explore.pagination}>
      {page > 1 ? (
        <Link className="sf-btn sf-btn--ghost" href={href(page - 1)}>
          {copy.explore.previous}
        </Link>
      ) : (
        <span className="sf-btn sf-btn--ghost" aria-disabled="true">
          {copy.explore.previous}
        </span>
      )}
      <span className="sf-mono sf-list__muted">{label}</span>
      {page < pages ? (
        <Link className="sf-btn sf-btn--ghost" href={href(page + 1)}>
          {copy.explore.next}
        </Link>
      ) : (
        <span className="sf-btn sf-btn--ghost" aria-disabled="true">
          {copy.explore.next}
        </span>
      )}
    </nav>
  )
}
