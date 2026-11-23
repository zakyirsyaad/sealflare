import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Instrument_Sans, Geist_Mono } from 'next/font/google'
import './globals.css'

const instrument = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-instrument' })
const geist = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-geist' })
export const metadata: Metadata = { title: { default: 'Sealflare', template: '%s | Sealflare' }, description: 'A security registry and AI skill firewall on BNB Chain.' }
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" data-theme="dark" className={`${instrument.variable} ${geist.variable}`}><body>{children}</body></html>
}
