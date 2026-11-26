import Link from 'next/link'

/** The words of the way through the pages. Every list brings its own. */
export type PageLabels = {
  page: string
  pagination: string
  previous: string
  next: string
}

/**
 * The way through the pages of a list.
 *
 * The number of pages comes from the total the server counted, so the reader never walks onto
 * a page that does not exist.
 */
export function PageLinks({
  page,
  pages,
  href,
  labels,
}: {
  page: number
  pages: number
  href: (page: number) => string
  labels: PageLabels
}) {
  const label = labels.page.replace('{page}', String(page)).replace('{pages}', String(pages))
  return (
    <nav className="sf-list__pages" aria-label={labels.pagination}>
      {page > 1 ? (
        <Link className="sf-btn sf-btn--ghost" href={href(page - 1)}>
          {labels.previous}
        </Link>
      ) : (
        <span className="sf-btn sf-btn--ghost" aria-disabled="true">
          {labels.previous}
        </span>
      )}
      <span className="sf-mono sf-list__muted">{label}</span>
      {page < pages ? (
        <Link className="sf-btn sf-btn--ghost" href={href(page + 1)}>
          {labels.next}
        </Link>
      ) : (
        <span className="sf-btn sf-btn--ghost" aria-disabled="true">
          {labels.next}
        </span>
      )}
    </nav>
  )
}
