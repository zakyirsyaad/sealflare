import type { ReactNode } from 'react'
import { AppHeader } from '../../components/AppHeader'
import { Web3Provider } from '../../components/wallet/Web3Provider'
import { ActivityProvider } from '../../lib/activity/ActivityProvider'
import { copy } from '../../lib/copy'
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <Web3Provider><ActivityProvider><a className="sf-skip" href="#main-content">{copy.common.skip}</a><AppHeader /><main id="main-content" className="sf-container" tabIndex={-1}>{children}</main></ActivityProvider></Web3Provider>
}
