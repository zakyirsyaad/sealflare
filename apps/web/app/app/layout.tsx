import type { ReactNode } from 'react'
import { AppHeader } from '../../components/AppHeader'
import { copy } from '../../lib/copy'
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <><a className="sf-skip" href="#main-content">{copy.common.skip}</a><AppHeader /><main id="main-content" className="sf-container" tabIndex={-1}>{children}</main></>
}
