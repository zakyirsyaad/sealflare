'use client'
import { useConnect, useConnectors, type Connector } from 'wagmi'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'

// The connection never asks the wallet to switch chains. A switch asked inside connect() turns a
// refused network change into a rejected connection, and the visitor never reaches the screen
// that explains the wrong network. The app shows that screen itself, with its own switch button.
const genericId = 'injected'
const walletConnectId = 'walletConnect'

const label = (connector: Connector) => {
  if (connector.id === genericId) return copy.wallet.browserWallet
  if (connector.id === walletConnectId) return copy.wallet.walletConnect
  return connector.name
}

// A wallet found by EIP-6963 has its own entry, so the generic one would list the same wallet twice.
const visibleConnectors = (connectors: readonly Connector[]) => {
  const discovered = connectors.some(connector => connector.id !== genericId && connector.id !== walletConnectId)
  return discovered ? connectors.filter(connector => connector.id !== genericId) : [...connectors]
}

export function ConnectPrompt({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  const hasQr = connectors.some(connector => connector.id === walletConnectId)
  const failed = error !== null && error !== undefined && translateContractError(error) !== null
  return <Panel title={copy.wallet.connectTitle} onClose={onClose}>
    <p className="sf-lead">{copy.wallet.connectIntro}</p>
    <ul className="sf-connectors">
      {visibleConnectors(connectors).map(connector => <li key={connector.uid}>
        <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector }, { onSuccess: onClose })}>{label(connector)}</Button>
      </li>)}
    </ul>
    {failed && <p role="alert" className="sf-lead">{copy.wallet.connectFailed}</p>}
    {(isPending || hasQr) && <p className="sf-lead">{isPending ? copy.wallet.connecting : copy.wallet.mobileQr}</p>}
  </Panel>
}
