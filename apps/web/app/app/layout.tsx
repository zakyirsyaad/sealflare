import type { ReactNode } from 'react'
import { AppHeader } from '../../components/AppHeader'
import { Web3Provider } from '../../components/wallet/Web3Provider'
import { copy } from '../../lib/copy'
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <Web3Provider><a className="sf-skip" href="#main-content">{copy.common.skip}</a><AppHeader /><main id="main-content" className="sf-container" tabIndex={-1}>{children}</main></Web3Provider>
}
