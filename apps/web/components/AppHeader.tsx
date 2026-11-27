"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { WalletButton } from './wallet/WalletButton'
import { useSharedActivity } from '../lib/activity/ActivityProvider'
import { copy } from '../lib/copy'

const links = [
  { href: '/app', label: copy.nav.scan },
  { href: '/app/explore', label: copy.nav.explore },
  { href: '/app/disputes', label: copy.nav.disputes },
  { href: '/app/bounties', label: copy.nav.bounties },
  { href: '/app/guardians', label: copy.nav.guardians },
]
export function AppHeader() {
  const pathname = usePathname()
  const [light, setLight] = useState(false)
  // The mark on the wallet button says how many things wait on the account. It counts the rows
  // of the panel of My activity, because both read the same rows.
  const activity = useSharedActivity()
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark' }, [light])
  return <header className="sf-app-header"><div className="sf-app-header__inner">
    <Link className="sf-wordmark" href="/app" aria-label="Sealflare">seal<span>flare</span></Link>
    <nav className="sf-appnav" aria-label={copy.common.appLabel}>
      {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link>)}
    </nav>
    <div className="sf-header-actions">
      <label className="sf-theme"><input type="checkbox" checked={light} onChange={event => setLight(event.target.checked)} />{copy.nav.theme}</label>
      <WalletButton pendingCount={activity.count} />
    </div>
  </div></header>
}
