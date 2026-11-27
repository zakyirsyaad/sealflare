'use client'
import type { Connector } from 'wagmi'
import { copy } from '../copy'

// The connection never asks the wallet to switch chains. A switch asked inside connect() turns a
// refused network change into a rejected connection, and the visitor never reaches the screen
// that explains the wrong network. The app shows that screen itself, with its own switch button.
const genericId = 'injected'
const walletConnectId = 'walletConnect'

/** The name the app gives a wallet, so a raw connector name never reaches the reader. */
export function connectorLabel(connector: Connector): string {
  if (connector.id === genericId) return copy.wallet.browserWallet
  if (connector.id === walletConnectId) return copy.wallet.walletConnect
  return connector.name
}

/**
 * The wallets the reader may choose.
 *
 * A wallet found by EIP-6963 has its own entry, so the generic one would list the same wallet
 * twice. Every screen that offers a wallet shows the same list.
 */
export function visibleConnectors(connectors: readonly Connector[]): Connector[] {
  const discovered = connectors.some(connector => connector.id !== genericId && connector.id !== walletConnectId)
  return discovered ? connectors.filter(connector => connector.id !== genericId) : [...connectors]
}
